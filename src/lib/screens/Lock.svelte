<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import ConnectionBadge from '../components/ConnectionBadge.svelte'
  import UpdateButton from '../components/UpdateButton.svelte'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import Logo from '../ui/Logo.svelte'

  let { onsettings }: { onsettings: () => void } = $props()

  const LAST_KEY = 'credix-desktop.last-seller'
  const ROLE: Record<string, string> = { owner: 'Proprietário', manager: 'Gerente', seller: 'Vendedor' }

  /** 'unlock': entrar para vender; 'disconnect': dono/gerente desconecta o caixa. */
  let mode = $state<'unlock' | 'disconnect'>('unlock')
  let sellerId = $state('')
  let pin = $state('')
  let error = $state('')
  let checking = $state(false)
  let shake = $state(false)
  let now = $state(new Date())
  let selectEl = $state<HTMLSelectElement>()
  let clock: ReturnType<typeof setInterval> | undefined

  // Lista em ordem alfabética; com muitos vendedores, o select aceita digitar o começo do nome.
  const sellers = $derived(
    [...(session.info?.sellers ?? [])]
      .filter((s) => mode === 'unlock' || s.can_manage)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  )
  const picked = $derived(sellers.find((s) => s.id === sellerId) ?? null)

  function readLast(): string {
    try {
      return localStorage.getItem(LAST_KEY) ?? ''
    } catch {
      return ''
    }
  }

  // Começa no último vendedor que entrou neste caixa (se ainda estiver na lista).
  $effect(() => {
    if (!sellers.some((s) => s.id === sellerId)) {
      const last = readLast()
      sellerId = sellers.some((s) => s.id === last && s.has_pin) ? last : ''
    }
  })

  onMount(() => {
    session.refresh()
    clock = setInterval(() => (now = new Date()), 15_000)
    focusSelect()
  })
  onDestroy(() => clearInterval(clock))

  async function focusSelect() {
    await tick()
    if (!sellerId) selectEl?.focus()
  }

  function onPick() {
    pin = ''
    error = picked && !picked.has_pin ? `${picked.first_name} ainda não tem PIN. Peça ao dono para cadastrar em Usuários, no Credix web.` : ''
    selectEl?.blur()
  }

  function press(d: string) {
    if (checking || pin.length >= 4) return
    if (!picked) {
      error = mode === 'disconnect' ? 'Escolha o dono ou gerente.' : 'Escolha quem vai vender.'
      selectEl?.focus()
      return
    }
    if (!picked.has_pin) return
    pin += d
    error = ''
    if (pin.length === 4) submit()
  }

  function erase() {
    pin = pin.slice(0, -1)
  }

  async function submit() {
    if (!picked) return
    checking = true
    try {
      if (mode === 'disconnect') {
        await session.disconnect(picked, pin)
      } else {
        await session.unlock(picked, pin)
        try {
          localStorage.setItem(LAST_KEY, picked.id)
        } catch {
          // ignorado
        }
      }
    } catch (e) {
      error = (e as Error).message
      pin = ''
      shake = true
      setTimeout(() => (shake = false), 400)
    } finally {
      checking = false
    }
  }

  function setMode(m: 'unlock' | 'disconnect') {
    mode = m
    sellerId = ''
    pin = ''
    error = ''
    focusSelect()
  }

  function keydown(e: KeyboardEvent) {
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      press(e.key)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      erase()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (pin) pin = ''
      else if (mode === 'disconnect') setMode('unlock')
    }
  }

  const time = $derived(now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
  const date = $derived(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))
</script>

<svelte:window onkeydown={keydown} />

<div class="lock">
  <aside>
    <div class="brand">
      <Logo size={40} />
      <div>
        <strong>{session.company?.name ?? 'Credix'}</strong>
        <span>Credix PDV · {session.info?.terminal.name ?? ''}</span>
      </div>
    </div>
    <div class="status">
      <ConnectionBadge dark />
      <UpdateButton dark />
    </div>
    <div class="clock">
      <strong>{time}</strong>
      <span>{date}</span>
    </div>
    <div class="foot">
      <button class="ghost" onclick={onsettings}><Icon name="printer" size={16} /> Impressora</button>
      {#if mode === 'unlock'}
        <button class="ghost" onclick={() => setMode('disconnect')}><Icon name="power" size={16} /> Desconectar caixa</button>
      {/if}
    </div>
  </aside>

  <main>
    <div class="pane">
      <div class="head">
        <h1>{mode === 'disconnect' ? 'Desconectar este caixa' : 'Quem vai vender?'}</h1>
        <p class="muted">
          {mode === 'disconnect'
            ? 'Escolha um dono ou gerente e digite o PIN dele.'
            : 'Escolha seu nome e digite seu PIN de 4 números.'}
        </p>
      </div>

      <label class="who">
        {mode === 'disconnect' ? 'Dono ou gerente' : 'Vendedor'}
        <div class="select">
          {#if picked}<span class="avatar sm">{picked.initials}</span>{/if}
          <select bind:this={selectEl} bind:value={sellerId} onchange={onPick} class:withAvatar={!!picked}>
            <option value="" disabled>Escolha seu nome…</option>
            {#each sellers as s (s.id)}
              <option value={s.id} disabled={!s.has_pin}>
                {s.name} · {s.has_pin ? (ROLE[s.role ?? ''] ?? 'Vendedor') : 'sem PIN'}
              </option>
            {/each}
          </select>
        </div>
      </label>

      <div class="dots" class:shake aria-label="PIN">
        {#each [0, 1, 2, 3] as i (i)}<span class:on={pin.length > i}></span>{/each}
      </div>

      {#if error}
        <div class="alert">{error}</div>
      {:else if !sellers.length}
        <div class="alert warn">Nenhum vendedor ativo. Cadastre a equipe em Usuários, no Credix web.</div>
      {/if}

      <div class="pad" class:off={!picked}>
        {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
          <button class="key" onclick={() => press(d)} disabled={checking}>{d}</button>
        {/each}
        <button class="key fn" onclick={() => (pin = '')} disabled={checking || !pin} aria-label="Limpar">Limpar</button>
        <button class="key" onclick={() => press('0')} disabled={checking}>0</button>
        <button class="key fn" onclick={erase} disabled={checking || !pin} aria-label="Apagar"><Icon name="backspace" size={22} /></button>
      </div>

      {#if mode === 'disconnect'}
        <button class="ghost back" onclick={() => setMode('unlock')}><Icon name="back" size={16} /> Voltar</button>
      {/if}
    </div>
  </main>
</div>

<style>
  .lock {
    height: 100%;
    display: grid;
    grid-template-columns: 380px 1fr;
  }
  aside {
    background: linear-gradient(160deg, #1d4ed8, #1e3a8a);
    color: #fff;
    padding: 32px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .status {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .brand :global(rect) {
    fill: #fff;
  }
  .brand :global(path) {
    stroke: #1d4ed8;
  }
  .brand div {
    display: grid;
  }
  .brand strong {
    font-size: 17px;
    font-weight: 800;
  }
  .brand span {
    font-size: 12px;
    opacity: 0.75;
    font-weight: 600;
  }
  .clock {
    display: grid;
  }
  .clock strong {
    font-size: 72px;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .clock span {
    font-size: 16px;
    opacity: 0.8;
    text-transform: capitalize;
    margin-top: 8px;
  }
  .foot {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .foot button {
    color: #fff;
    opacity: 0.85;
    height: 38px;
  }
  .foot button:hover:not(:disabled) {
    background: rgb(255 255 255 / 12%);
  }
  main {
    display: grid;
    place-items: center;
    padding: 32px;
    overflow: auto;
  }
  .pane {
    width: 360px;
    display: grid;
    gap: 18px;
  }
  .head {
    text-align: center;
    display: grid;
    gap: 4px;
  }
  h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .who {
    color: var(--muted);
  }
  .select {
    position: relative;
  }
  .select .avatar {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .avatar.sm {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    font-size: 12px;
  }
  select {
    height: 54px;
    font-size: 16px;
    font-weight: 700;
    color: var(--ink);
    border-radius: 14px;
    cursor: pointer;
  }
  select.withAvatar {
    padding-left: 52px;
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: 18px;
    margin: 4px 0;
  }
  .dots span {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid #cbd5e1;
  }
  .dots span.on {
    background: var(--brand);
    border-color: var(--brand);
  }
  .shake {
    animation: shake 0.35s;
  }
  @keyframes shake {
    25% {
      transform: translateX(-8px);
    }
    75% {
      transform: translateX(8px);
    }
  }
  /* Teclado numérico com cara de tecla: borda, fundo e "altura" embaixo. */
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    padding: 14px;
    border-radius: 22px;
    background: #e9edf3;
    border: 1px solid #d5dbe4;
    box-shadow: inset 0 1px 2px rgb(15 23 42 / 6%);
  }
  .pad.off {
    opacity: 0.6;
  }
  .key {
    height: 64px;
    border-radius: 14px;
    border: 1px solid #c4ccd8;
    border-bottom-width: 4px;
    background: linear-gradient(#ffffff, #f6f8fb);
    color: var(--ink);
    font-size: 26px;
    font-weight: 700;
    box-shadow: 0 1px 2px rgb(15 23 42 / 10%);
    transition: transform 0.05s, border-bottom-width 0.05s;
  }
  .key:hover:not(:disabled) {
    background: linear-gradient(#ffffff, #eef2f7);
    border-color: #b3bdcc;
  }
  .key:active:not(:disabled) {
    transform: translateY(3px);
    border-bottom-width: 1px;
    margin-bottom: 3px;
  }
  .key:disabled {
    opacity: 1;
    color: var(--faint);
  }
  .key.fn {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    background: linear-gradient(#f1f4f8, #e6ebf2);
  }
  .back {
    justify-self: center;
    padding: 0 10px;
  }
</style>
