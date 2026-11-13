<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { Seller } from '../api'
  import ConnectionBadge from '../components/ConnectionBadge.svelte'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import Logo from '../ui/Logo.svelte'

  let { onsettings }: { onsettings: () => void } = $props()

  /** 'unlock': entrar para vender; 'disconnect': dono/gerente desconecta o caixa. */
  let mode = $state<'unlock' | 'disconnect'>('unlock')
  let picked = $state<Seller | null>(null)
  let pin = $state('')
  let error = $state('')
  let checking = $state(false)
  let shake = $state(false)
  let now = $state(new Date())
  let clock: ReturnType<typeof setInterval> | undefined

  const ROLE: Record<string, string> = { owner: 'Proprietário', manager: 'Gerente', seller: 'Vendedor' }

  const sellers = $derived(
    (session.info?.sellers ?? []).filter((s) => mode === 'unlock' || s.can_manage),
  )

  onMount(() => {
    session.refresh()
    clock = setInterval(() => (now = new Date()), 15_000)
  })
  onDestroy(() => clearInterval(clock))

  function pick(s: Seller) {
    if (!s.has_pin) {
      error = `${s.first_name} ainda não tem PIN. Peça ao dono para cadastrar em Usuários, no Credix web.`
      return
    }
    picked = s
    pin = ''
    error = ''
  }

  function back() {
    picked = null
    pin = ''
    error = ''
  }

  function press(d: string) {
    if (checking || !picked || pin.length >= 4) return
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
      if (mode === 'disconnect') await session.disconnect(picked, pin)
      else await session.unlock(picked, pin)
    } catch (e) {
      error = (e as Error).message
      pin = ''
      shake = true
      setTimeout(() => (shake = false), 400)
    } finally {
      checking = false
    }
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
      if (picked) back()
      else if (mode === 'disconnect') mode = 'unlock'
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
    <ConnectionBadge dark />
    <div class="clock">
      <strong>{time}</strong>
      <span>{date}</span>
    </div>
    <div class="foot">
      <button class="ghost" onclick={onsettings}><Icon name="printer" size={16} /> Impressora</button>
      {#if mode === 'unlock'}
        <button class="ghost" onclick={() => ((mode = 'disconnect'), back())}><Icon name="power" size={16} /> Desconectar caixa</button>
      {/if}
    </div>
  </aside>

  <main>
    {#if !picked}
      <div class="pane">
        <div>
          <h1>{mode === 'disconnect' ? 'Desconectar este caixa' : 'Quem vai vender?'}</h1>
          <p class="muted">
            {mode === 'disconnect'
              ? 'Escolha um dono ou gerente e digite o PIN dele. O caixa volta para a tela de conexão.'
              : 'Escolha seu nome e digite seu PIN de 4 números.'}
          </p>
        </div>
        <div class="sellers">
          {#each sellers as s (s.id)}
            <button class="seller" class:nopin={!s.has_pin} onclick={() => pick(s)}>
              <span class="avatar">{s.initials}</span>
              <span class="who">
                <strong>{s.name}</strong>
                <span>{s.has_pin ? (ROLE[s.role ?? ''] ?? 'Vendedor') : 'Sem PIN'}</span>
              </span>
            </button>
          {:else}
            <p class="muted">Nenhum vendedor ativo. Cadastre a equipe em Usuários, no Credix web.</p>
          {/each}
        </div>
        {#if error}<div class="alert warn">{error}</div>{/if}
        {#if mode === 'disconnect'}
          <button class="ghost back" onclick={() => (mode = 'unlock')}><Icon name="back" size={16} /> Voltar</button>
        {/if}
      </div>
    {:else}
      <div class="pane pinpane">
        <button class="ghost back" onclick={back}><Icon name="back" size={16} /> Trocar vendedor</button>
        <span class="avatar big">{picked.initials}</span>
        <div class="center">
          <h1>{picked.name}</h1>
          <p class="muted">{mode === 'disconnect' ? 'PIN para desconectar o caixa' : 'Digite seu PIN'}</p>
        </div>
        <div class="dots" class:shake aria-label="PIN">
          {#each [0, 1, 2, 3] as i (i)}<span class:on={pin.length > i}></span>{/each}
        </div>
        {#if error}<div class="alert">{error}</div>{/if}
        <div class="pad">
          {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
            <button onclick={() => press(d)} disabled={checking}>{d}</button>
          {/each}
          <span></span>
          <button onclick={() => press('0')} disabled={checking}>0</button>
          <button class="ghost" onclick={erase} aria-label="Apagar"><Icon name="backspace" size={22} /></button>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .lock {
    height: 100%;
    display: grid;
    grid-template-columns: 380px 1fr;
  }
  aside > :global(.conn) {
    align-self: flex-start;
  }
  aside {
    background: var(--brand);
    background: linear-gradient(160deg, #1d4ed8, #1e3a8a);
    color: #fff;
    padding: 32px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
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
    width: min(720px, 100%);
    display: grid;
    gap: 20px;
  }
  h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .sellers {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
  }
  .seller {
    height: auto;
    padding: 16px;
    border-radius: 18px;
    justify-content: flex-start;
    gap: 12px;
    text-align: left;
  }
  .seller:hover:not(:disabled) {
    border-color: var(--brand);
    background: var(--brand-50);
  }
  .seller.nopin {
    opacity: 0.55;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who strong {
    font-size: 15px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who span {
    font-size: 12px;
    color: var(--muted);
  }
  .back {
    justify-self: start;
    padding: 0 10px;
  }
  .pinpane {
    width: 340px;
    justify-items: center;
  }
  .avatar.big {
    width: 72px;
    height: 72px;
    border-radius: 22px;
    font-size: 24px;
  }
  .center {
    text-align: center;
  }
  .dots {
    display: flex;
    gap: 16px;
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
  .pad {
    display: grid;
    grid-template-columns: repeat(3, 84px);
    gap: 12px;
  }
  .pad button {
    height: 64px;
    border-radius: 18px;
    font-size: 24px;
    font-weight: 700;
    color: var(--ink);
  }
</style>
