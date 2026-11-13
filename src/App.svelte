<script lang="ts">
  import { onMount } from 'svelte'
  import { modalStack } from './lib/components/modalStack'
  import SettingsModal from './lib/components/SettingsModal.svelte'
  import { printerReady } from './lib/printer'
  import Lock from './lib/screens/Lock.svelte'
  import Pair from './lib/screens/Pair.svelte'
  import ReceiveScreen from './lib/screens/ReceiveScreen.svelte'
  import SaleScreen from './lib/screens/SaleScreen.svelte'
  import { session } from './lib/session.svelte'
  import Icon from './lib/ui/Icon.svelte'
  import Logo from './lib/ui/Logo.svelte'

  let tab = $state<'sale' | 'receive'>('sale')
  let settingsOpen = $state(false)
  let online = $state(navigator.onLine)

  onMount(() => {
    session.refresh()
    const up = () => (online = true)
    const down = () => (online = false)
    addEventListener('online', up)
    addEventListener('offline', down)

    // Bloqueio por inatividade: volta a tela de PIN (não interrompe Pix aguardando).
    const idle = setInterval(() => {
      if (!session.seller || session.busy > 0) return
      if (Date.now() - session.lastActivity > session.lockMinutes * 60_000) lockNow()
    }, 10_000)

    return () => {
      clearInterval(idle)
      removeEventListener('online', up)
      removeEventListener('offline', down)
    }
  })

  function lockNow() {
    settingsOpen = false
    tab = 'sale'
    session.lock()
  }

  function keydown(e: KeyboardEvent) {
    session.touch()
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) e.preventDefault()
    if (!session.seller || modalStack.open) return
    if (e.key === 'F1') {
      e.preventDefault()
      tab = 'sale'
    } else if (e.key === 'F2') {
      e.preventDefault()
      tab = 'receive'
    } else if (e.key === 'F12') {
      e.preventDefault()
      settingsOpen = true
    } else if (e.key === 'F11' || (e.ctrlKey && e.key.toLowerCase() === 'l')) {
      e.preventDefault()
      lockNow()
    }
  }
</script>

<svelte:window
  onkeydown={keydown}
  onpointerdown={() => session.touch()}
  onwheel={() => session.touch()}
  oncontextmenu={(e) => import.meta.env.PROD && e.preventDefault()}
/>

{#if !session.paired}
  <Pair />
{:else if !session.seller}
  <Lock onsettings={() => (settingsOpen = true)} />
{:else}
  <div class="shell">
    <header>
      <div class="brand">
        <Logo size={32} />
        <div>
          <strong>{session.company?.name ?? 'Credix'}</strong>
          <span>Credix PDV · {session.info?.terminal.name}</span>
        </div>
      </div>
      <nav>
        <button class:on={tab === 'sale'} onclick={() => (tab = 'sale')}>Venda <kbd>F1</kbd></button>
        <button class:on={tab === 'receive'} onclick={() => (tab = 'receive')}>Receber <kbd>F2</kbd></button>
      </nav>
      <span class="spacer"></span>
      {#if !online}
        <span class="pill bad"><Icon name="wifiOff" size={14} /> Sem internet</span>
      {/if}
      {#if printerReady(session.settings)}
        <span class="pill good"><Icon name="printer" size={14} /> Impressora</span>
      {:else}
        <span class="pill"><Icon name="printer" size={14} /> Sem impressora</span>
      {/if}
      <button class="me ghost" onclick={lockNow} title="Trocar vendedor (F11)">
        <span class="avatar sm">{session.seller.initials}</span>
        {session.seller.first_name}
        <Icon name="lock" size={15} />
      </button>
      <button class="icon" onclick={() => (settingsOpen = true)} aria-label="Configurações (F12)"><Icon name="gear" /></button>
    </header>
    <main>
      {#key session.seller.id}
        <div class="tab" class:hidden={tab !== 'sale'}><SaleScreen active={tab === 'sale' && !settingsOpen} /></div>
        <div class="tab" class:hidden={tab !== 'receive'}><ReceiveScreen active={tab === 'receive' && !settingsOpen} /></div>
      {/key}
    </main>
  </div>
{/if}

{#if settingsOpen}
  <SettingsModal onclose={() => (settingsOpen = false)} />
{/if}

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 20px;
    background: #fff;
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand div {
    display: grid;
  }
  .brand strong {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .brand span {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
  nav {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--soft);
    border-radius: 12px;
  }
  nav button {
    height: 36px;
    border: 0;
    background: transparent;
    border-radius: 9px;
    color: #475569;
  }
  nav button.on {
    background: #fff;
    color: var(--brand);
    font-weight: 700;
    box-shadow: 0 1px 2px rgb(15 23 42 / 8%);
  }
  nav button.on kbd {
    border-color: var(--brand-200);
    color: var(--brand);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    background: var(--soft);
    color: var(--muted);
  }
  .pill.good {
    background: #d1fae5;
    color: var(--ok);
  }
  .pill.bad {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .me {
    height: 40px;
    padding: 0 10px 0 4px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .avatar.sm {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    font-size: 12px;
  }
  .icon {
    width: 38px;
    height: 38px;
    padding: 0;
    color: #475569;
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
