<script lang="ts">
  import { onMount } from 'svelte'
  import { modalStack } from './lib/components/modalStack'
  import SettingsModal from './lib/components/SettingsModal.svelte'
  import { printerReady } from './lib/printer'
  import Login from './lib/screens/Login.svelte'
  import ReceiveScreen from './lib/screens/ReceiveScreen.svelte'
  import SaleScreen from './lib/screens/SaleScreen.svelte'
  import { session } from './lib/session.svelte'

  let tab = $state<'sale' | 'receive'>('sale')
  let settingsOpen = $state(false)
  let online = $state(navigator.onLine)

  onMount(() => {
    session.restore()
    const up = () => (online = true)
    const down = () => (online = false)
    addEventListener('online', up)
    addEventListener('offline', down)
    return () => {
      removeEventListener('online', up)
      removeEventListener('offline', down)
    }
  })

  function keydown(e: KeyboardEvent) {
    if (!session.user || modalStack.open) return
    if (e.key === 'F1') {
      e.preventDefault()
      tab = 'sale'
    } else if (e.key === 'F2') {
      e.preventDefault()
      tab = 'receive'
    } else if (e.key === 'F12') {
      e.preventDefault()
      settingsOpen = true
    }
  }

  // Evita recarregar a página (F5) e o menu do navegador no meio de uma venda.
  function blockBrowserKeys(e: KeyboardEvent) {
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) e.preventDefault()
  }
</script>

<svelte:window onkeydown={(e) => (blockBrowserKeys(e), keydown(e))} oncontextmenu={(e) => import.meta.env.PROD && e.preventDefault()} />

{#if session.restoring}
  <div class="center muted">Conectando…</div>
{:else if !session.user}
  <Login />
{:else}
  <div class="shell">
    <header>
      <strong class="brand">{session.user.company?.name ?? 'Credix'}</strong>
      <nav>
        <button class:on={tab === 'sale'} onclick={() => (tab = 'sale')}>Venda<kbd>F1</kbd></button>
        <button class:on={tab === 'receive'} onclick={() => (tab = 'receive')}>Receber<kbd>F2</kbd></button>
      </nav>
      <span class="spacer"></span>
      {#if !online}<span class="badge late">Sem internet</span>{/if}
      {#if !printerReady(session.settings)}<span class="badge">Sem impressora</span>{/if}
      <span class="muted">{session.user.first_name}</span>
      <button class="ghost" onclick={() => (settingsOpen = true)}>Configurações<kbd>F12</kbd></button>
      <button class="ghost" onclick={() => session.logout()}>Sair</button>
    </header>
    <main>
      <div class="tab" class:hidden={tab !== 'sale'}><SaleScreen active={tab === 'sale' && !settingsOpen} /></div>
      <div class="tab" class:hidden={tab !== 'receive'}><ReceiveScreen active={tab === 'receive' && !settingsOpen} /></div>
    </main>
  </div>
{/if}

{#if settingsOpen}
  <SettingsModal onclose={() => (settingsOpen = false)} />
{/if}

<style>
  .center {
    height: 100%;
    display: grid;
    place-items: center;
  }
  .shell {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    background: #fff;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    font-size: 16px;
    margin-right: 8px;
  }
  nav {
    display: flex;
    gap: 6px;
  }
  nav button {
    border-color: transparent;
  }
  nav button.on {
    background: #eef4ff;
    color: var(--brand);
    border-color: #c7dbff;
  }
  main {
    min-height: 0;
    position: relative;
  }
  .tab {
    position: absolute;
    inset: 0;
  }
  .hidden {
    display: none;
  }
</style>
