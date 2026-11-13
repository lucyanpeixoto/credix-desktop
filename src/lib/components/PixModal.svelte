<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { PixCharge } from '../api'
  import { fmt } from '../money'
  import { session } from '../session.svelte'
  import Modal from './Modal.svelte'

  let {
    charge: initial,
    onpaid,
    oncancelled,
  }: {
    charge: PixCharge
    onpaid: (c: PixCharge) => void
    /** Cancelado pelo caixa, vencido ou recusado. A venda volta o estoque no servidor. */
    oncancelled: (reason: string) => void
  } = $props()

  // O modal começa com a cobrança recebida e passa a seguir a consulta.
  // svelte-ignore state_referenced_locally
  let charge = $state<PixCharge>(initial)
  let error = $state('')
  let cancelling = $state(false)
  let copied = $state(false)
  let now = $state(Date.now())
  let poll: ReturnType<typeof setInterval> | undefined
  let tick: ReturnType<typeof setInterval> | undefined
  let busy = false

  const left = $derived(Math.max(0, Math.floor((new Date(charge.expires_at).getTime() - now) / 1000)))
  const clock = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)

  async function check() {
    if (busy) return
    busy = true
    try {
      charge = await session.api.pix(charge.id)
      error = ''
      if (charge.status === 'paid') {
        stop()
        onpaid(charge)
      } else if (charge.status !== 'pending') {
        stop()
        oncancelled(charge.status === 'expired' ? 'O Pix venceu sem pagamento.' : 'O Pix foi cancelado.')
      }
    } catch (e) {
      error = (e as Error).message
    } finally {
      busy = false
    }
  }

  function stop() {
    clearInterval(poll)
    clearInterval(tick)
  }

  async function cancel() {
    if (cancelling) return
    cancelling = true
    try {
      charge = await session.api.cancelPix(charge.id)
      stop()
      // O cliente pode ter pago no último segundo.
      if (charge.status === 'paid') onpaid(charge)
      else oncancelled('Pix cancelado pelo caixa.')
    } catch (e) {
      error = (e as Error).message
    } finally {
      cancelling = false
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(charge.qr_code)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      // Sem área de transferência: o código está visível para copiar à mão.
    }
  }

  onMount(() => {
    poll = setInterval(check, 3000)
    tick = setInterval(() => (now = Date.now()), 1000)
  })
  onDestroy(stop)
</script>

<Modal title="Pagamento com Pix" onclose={cancel} width="460px">
  <div class="center">
    <div class="amount">{fmt(charge.amount)}</div>
    {#if charge.qr_code_base64}
      <img src={`data:image/png;base64,${charge.qr_code_base64}`} alt="QR Code do Pix" />
    {/if}
    <div class="status">
      <span class="dot"></span> Aguardando o cliente pagar · vence em {clock}
    </div>
    <button onclick={copy}>{copied ? 'Copiado!' : 'Copiar Pix copia e cola'}</button>
    {#if error}<div class="alert warn">{error}</div>{/if}
  </div>

  {#snippet footer()}
    <button class="danger" onclick={cancel} disabled={cancelling}>{cancelling ? 'Cancelando…' : 'Cancelar Pix'}</button>
    <button onclick={check}>Já pagou? Conferir</button>
  {/snippet}
</Modal>

<style>
  .center {
    display: grid;
    justify-items: center;
    gap: 12px;
  }
  .amount {
    font-size: 30px;
    font-weight: 700;
  }
  img {
    width: 260px;
    height: 260px;
    image-rendering: pixelated;
  }
  .status {
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--brand);
    animation: pulse 1.2s infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }
</style>
