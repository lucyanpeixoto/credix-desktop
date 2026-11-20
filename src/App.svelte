<script lang="ts">
  import { onMount } from 'svelte'
  import type { Customer, Sale } from './lib/api'
  import AfterHoursModal from './lib/components/AfterHoursModal.svelte'
  import CashModal from './lib/components/CashModal.svelte'
  import ConnectionBadge from './lib/components/ConnectionBadge.svelte'
  import UpdateButton from './lib/components/UpdateButton.svelte'
  import { updater } from './lib/updater.svelte'
  import { modalStack } from './lib/components/modalStack'
  import { fmt } from './lib/money'
  import SettingsModal from './lib/components/SettingsModal.svelte'
  import ShortcutsModal from './lib/components/ShortcutsModal.svelte'
  import { printerReady } from './lib/printer'
  import { halfSheet } from './lib/print'
  import Lock from './lib/screens/Lock.svelte'
  import OpenCash from './lib/screens/OpenCash.svelte'
  import Pair from './lib/screens/Pair.svelte'
  import ReceiveScreen from './lib/screens/ReceiveScreen.svelte'
  import SaleScreen from './lib/screens/SaleScreen.svelte'
  import SalesScreen from './lib/screens/SalesScreen.svelte'
  import StaleCash from './lib/screens/StaleCash.svelte'
  import { session } from './lib/session.svelte'
  import Icon from './lib/ui/Icon.svelte'
  import Logo from './lib/ui/Logo.svelte'

  let tab = $state<'sale' | 'receive' | 'sales'>('sale')
  let settingsOpen = $state(false)
  let cashOpen = $state(false)
  let helpOpen = $state(false)
  /** Caixa aberto direto no fechamento (venda depois do horário, "abrir o de amanhã"). */
  let cashClosing = $state(false)
  /** Venda aberta na aba Vendas para receber na aba Receber. */
  let receiveSale = $state<Sale | null>(null)

  function receiveFrom(s: Sale) {
    receiveSale = s
    tab = 'receive'
  }
  /** "Receber agora" na venda: abre o Receber já no cliente (o carrinho fica como está). */
  let receiveCustomer = $state<Customer | null>(null)
  function receiveFor(c: Customer) {
    receiveCustomer = c
    tab = 'receive'
  }
  onMount(() => {
    session.refresh()
    session.ping()
    updater.start()
    // Confere a conexão com o servidor a cada 20 s e quando a rede muda.
    const ping = setInterval(() => session.ping(), 20_000)
    const up = () => session.ping()
    const down = () => session.ping()
    addEventListener('online', up)
    addEventListener('offline', down)

    // Bloqueio por inatividade: volta a tela de PIN (não interrompe Pix aguardando).
    const idle = setInterval(() => {
      if (!session.seller || session.busy > 0) return
      if (Date.now() - session.lastActivity > session.lockMinutes * 60_000) lockNow()
    }, 10_000)

    return () => {
      clearInterval(ping)
      clearInterval(idle)
      removeEventListener('online', up)
      removeEventListener('offline', down)
    }
  })

  function lockNow() {
    settingsOpen = false
    cashOpen = false
    helpOpen = false
    cashClosing = false
    tab = 'sale'
    session.lock()
  }

  function keydown(e: KeyboardEvent) {
    session.touch()
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) e.preventDefault()
    if (!session.seller || modalStack.open) return
    // "?" abre a lista de atalhos; com o cursor num campo (onde "?" é texto), Ctrl+/.
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
    if (e.ctrlKey ? e.key === '/' || e.key === '?' : e.key === '?' && !typing) {
      e.preventDefault()
      helpOpen = true
    } else if (e.key === 'F1') {
      e.preventDefault()
      tab = 'sale'
    } else if (e.key === 'F2') {
      e.preventDefault()
      tab = 'receive'
    } else if (e.key === 'F5') {
      e.preventDefault()
      tab = 'sales'
    } else if (e.key === 'F8' && session.cash?.session) {
      e.preventDefault()
      if (!modalStack.open && session.seller) cashOpen = true
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
        <button class:on={tab === 'sales'} onclick={() => (tab = 'sales')}>Vendas <kbd>F5</kbd></button>
      </nav>
      <span class="spacer"></span>
      <UpdateButton />
      <ConnectionBadge />
      {#if session.cash?.session}
        <button class="drawer" onclick={() => (cashOpen = true)} title="Caixa: sangria, suprimento e fechamento">
          <Icon name="cash" size={16} />
          {session.cash.session.summary.expected_cash === null ? 'Caixa' : `Caixa · ${fmt(session.cash.session.summary.expected_cash)}`}
          <span class="sep">Sangria · Fechar</span>
          <kbd>F8</kbd>
        </button>
      {/if}
      {#if halfSheet(session.settings)}
        <span class="pill good" title="O comprovante sai em meia folha A4, pela impressora do computador"><Icon name="printer" size={14} /> Comprovante A4</span>
      {:else if printerReady(session.settings)}
        <span class="pill good" title="Impressora térmica configurada"><Icon name="printer" size={14} /> Térmica</span>
      {:else}
        <span class="pill"><Icon name="printer" size={14} /> Sem impressora</span>
      {/if}
      <button class="me ghost" onclick={lockNow} title="Trocar vendedor (F11)">
        <span class="avatar sm">{session.seller.initials}</span>
        {session.seller.first_name}
        <Icon name="lock" size={15} />
      </button>
      <button class="icon help" onclick={() => (helpOpen = true)} aria-label="Atalhos do teclado" title="Atalhos do teclado (?)">?</button>
      <button class="icon" onclick={() => (settingsOpen = true)} aria-label="Configurações (F12)"><Icon name="gear" /></button>
    </header>
    <main>
      <!-- Abrir (ou fechar o de outro dia) só para vender e receber; a consulta de vendas não precisa. -->
      {#if session.needsCashClose && tab !== 'sales'}
        <div class="tab"><StaleCash /></div>
      {:else if session.needsCashOpen && tab !== 'sales'}
        <div class="tab"><OpenCash /></div>
      {/if}
      {#key session.seller.id}
        <div class="tab" class:hidden={tab !== 'sale' || session.cashBlocked}>
          <SaleScreen active={tab === 'sale' && !settingsOpen && !cashOpen && !cashClosing && !session.cashBlocked} onreceive={receiveFor} />
        </div>
        <div class="tab" class:hidden={tab !== 'receive' || session.cashBlocked}>
          <ReceiveScreen
            active={tab === 'receive' && !settingsOpen && !cashOpen && !cashClosing && !session.cashBlocked}
            sale={receiveSale}
            onsaleloaded={() => (receiveSale = null)}
            pick={receiveCustomer}
            onpicked={() => (receiveCustomer = null)}
          />
        </div>
        <div class="tab" class:hidden={tab !== 'sales'}>
          <SalesScreen active={tab === 'sales' && !settingsOpen && !cashOpen} onreceive={receiveFrom} />
        </div>
      {/key}
    </main>
  </div>
{/if}

{#if settingsOpen}
  <SettingsModal onclose={() => (settingsOpen = false)} />
{/if}

{#if helpOpen}
  <ShortcutsModal cash={!!session.cash?.session} onclose={() => (helpOpen = false)} />
{/if}

{#if cashOpen && session.seller}
  <CashModal onclose={() => (cashOpen = false)} />
{/if}

{#if cashClosing && session.seller}
  <CashModal start="close" onclose={() => (cashClosing = false)} />
{/if}

{#if session.askAfterHours && session.seller && !cashOpen && !cashClosing}
  <AfterHoursModal onclosecash={() => (cashClosing = true)} />
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
  /* Janela estreita (Windows com escala 125%/150%): o nome da loja encolhe
     com reticências em vez de quebrar a barra em várias linhas. */
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 0 1 auto;
  }
  .brand div {
    display: grid;
    min-width: 0;
  }
  .brand strong,
  .brand span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    flex: none;
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
    flex: none;
    white-space: nowrap;
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
  @media (max-width: 1180px) {
    .drawer .sep {
      display: none;
    }
  }
  .drawer {
    flex: none;
    white-space: nowrap;
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    background: var(--ok-bg);
    border-color: #a7f3d0;
    color: var(--ok);
  }
  .drawer .sep {
    font-weight: 600;
    opacity: 0.75;
    padding-left: 8px;
    border-left: 1px solid #a7f3d0;
  }
  .drawer kbd {
    border-color: #6ee7b7;
    color: var(--ok);
  }
  .drawer:hover:not(:disabled) {
    background: #d1fae5;
    border-color: #6ee7b7;
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
  .icon.help {
    flex: none;
    font-size: 16px;
    font-weight: 800;
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
