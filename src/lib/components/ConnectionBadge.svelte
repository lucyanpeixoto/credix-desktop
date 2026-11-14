<script lang="ts">
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  let { dark = false }: { dark?: boolean } = $props()

  const time = $derived(
    session.lastCheck ? new Date(session.lastCheck).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null,
  )
</script>

<!-- Só indica a conexão com o Credix (conferida sozinha a cada 20 s); não é botão. -->
<span
  class="conn"
  class:off={!session.online}
  class:dark
  role="status"
  title={session.online
    ? `Conectado ao Credix${time ? ` · conferido às ${time}` : ''}`
    : 'Sem conexão com o Credix: vendas e recebimentos ficam pausados até a conexão voltar.'}
>
  <span class="dot"></span>
  <Icon name={session.online ? 'wifi' : 'wifiOff'} size={14} />
  {session.online ? 'Online' : 'Sem conexão'}
</span>

<style>
  .conn {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    gap: 6px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    background: #d1fae5;
    color: var(--ok);
    cursor: default;
    user-select: none;
  }
  .conn.off {
    background: var(--danger-bg);
    color: var(--danger);
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
