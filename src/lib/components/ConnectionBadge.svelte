<script lang="ts">
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  let { dark = false }: { dark?: boolean } = $props()
  let checking = $state(false)

  const time = $derived(
    session.lastCheck ? new Date(session.lastCheck).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null,
  )

  async function check() {
    checking = true
    await session.ping()
    checking = false
  }
</script>

<!-- Conexão com o servidor: o PDV ainda não vende sem internet. -->
<button
  class="conn"
  class:off={!session.online}
  class:dark
  onclick={check}
  disabled={checking}
  title={session.online
    ? `Conectado ao Credix${time ? ` · conferido às ${time}` : ''}. Clique para conferir agora.`
    : 'Sem conexão com o Credix: vendas e recebimentos ficam pausados até a conexão voltar. Clique para tentar de novo.'}
>
  <span class="dot"></span>
  <Icon name={session.online ? 'wifi' : 'wifiOff'} size={14} />
  {checking ? 'Conferindo…' : session.online ? 'Online' : 'Sem conexão'}
</button>

<style>
  .conn {
    height: 30px;
    padding: 0 10px;
    gap: 6px;
    border-radius: 999px;
    border: 0;
    font-size: 12px;
    font-weight: 700;
    background: #d1fae5;
    color: var(--ok);
  }
  .conn:hover:not(:disabled) {
    background: #a7f3d0;
  }
  .conn.off {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .conn.off:hover:not(:disabled) {
    background: #fecaca;
  }
  .conn.dark {
    background: rgb(255 255 255 / 15%);
    color: #fff;
  }
  .conn.dark.off {
    background: #fee2e2;
    color: var(--danger);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .conn:not(.off) .dot {
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
