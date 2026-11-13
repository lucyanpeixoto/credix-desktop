<script lang="ts">
  import { session } from '../session.svelte'

  let email = $state('')
  let password = $state('')
  let server = $state(session.settings.serverUrl)
  let showServer = $state(false)
  let loading = $state(false)
  let error = $state('')

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
      await session.login(email.trim(), password)
    } catch (err) {
      error = (err as Error).message
    } finally {
      loading = false
    }
  }
</script>

<div class="wrap">
  <form class="card panel" onsubmit={submit}>
    <div>
      <h1>Credix PDV</h1>
      <p class="muted">Entre com o mesmo usuário do Credix.</p>
    </div>

    <label>
      E-mail
      <!-- svelte-ignore a11y_autofocus -->
      <input type="email" bind:value={email} autocomplete="username" required autofocus />
    </label>
    <label>
      Senha
      <input type="password" bind:value={password} autocomplete="current-password" required />
    </label>

    {#if showServer}
      <label>
        Servidor
        <input bind:value={server} placeholder="https://pdv.lucyan.dev" />
      </label>
    {/if}

    {#if error}<div class="alert">{error}</div>{/if}

    <button class="primary big" type="submit" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
    {#if !showServer}
      <button type="button" class="ghost muted small" onclick={() => (showServer = true)}>
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
  }
  .card {
    width: 380px;
    padding: 28px;
    display: grid;
    gap: 16px;
  }
  h1 {
    font-size: 24px;
  }
  .small {
    font-size: 12px;
  }
</style>
