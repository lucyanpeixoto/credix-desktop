<script lang="ts">
  import { session } from '../session.svelte'
  import Logo from '../ui/Logo.svelte'

  let code = $state('')
  let server = $state(session.settings.serverUrl)
  let showServer = $state(false)
  let loading = $state(false)
  let error = $state('')

  // Mostra no formato do painel: K7P4-QX2M.
  function onInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    code = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    error = ''
    const url = server.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//.test(url)) {
      error = 'O endereço do servidor precisa começar com https://'
      showServer = true
      return
    }
    if (url !== session.settings.serverUrl) session.updateSettings({ ...session.settings, serverUrl: url })
    loading = true
    try {
      await session.pair(code)
    } catch (err) {
      error = (err as Error).message
    } finally {
      loading = false
    }
  }
</script>

<div class="wrap">
  <form class="card panel" onsubmit={submit}>
    <div class="head">
      <Logo size={44} />
      <div>
        <h1>Conectar este caixa</h1>
        <p class="muted">Credix PDV</p>
      </div>
    </div>

    <ol class="steps muted">
      <li>No Credix web, vá em <strong>Configurações › Terminais PDV</strong>.</li>
      <li>Crie o terminal (ex.: Caixa 01) ou clique em <strong>Gerar código</strong>.</li>
      <li>Digite aqui o código de 8 letras.</li>
    </ol>

    <label>
      Código de conexão
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="code"
        value={code}
        oninput={onInput}
        placeholder="XXXX-XXXX"
        autocomplete="off"
        spellcheck="false"
        autofocus
      />
    </label>

    {#if showServer}
      <label>
        Servidor
        <input bind:value={server} placeholder="https://pdv.lucyan.dev" />
      </label>
    {/if}

    {#if error}<div class="alert">{error}</div>{/if}

    <button class="primary big" type="submit" disabled={loading || code.replace('-', '').length < 8}>
      {loading ? 'Conectando…' : 'Conectar'}
    </button>
    {#if !showServer}
      <button type="button" class="ghost small muted" onclick={() => (showServer = true)}>
        Servidor: {session.settings.serverUrl}
      </button>
    {/if}
  </form>
</div>

<style>
  .wrap {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: 440px;
    padding: 32px;
    display: grid;
    gap: 18px;
    border-radius: 24px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 5%);
  }
  .head {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .steps {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
    font-size: 13px;
    line-height: 1.5;
  }
  .steps strong {
    color: var(--ink-2);
  }
  .code {
    height: 64px;
    text-align: center;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: 0.2em;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  }
</style>
