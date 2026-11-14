<script lang="ts">
  import type { Customer, PixCharge, Sale } from '../api'
  import { Attempt } from '../attempt'
  import { splitInstallments, type CartItem } from '../cart'
  import { dueDateIso, fmt, fmtDate, PAYMENT_LABELS, parseMoney, round2, todayIso } from '../money'
  import { session } from '../session.svelte'
  import CustomerPicker from './CustomerPicker.svelte'
  import Modal from './Modal.svelte'
  import PixModal from './PixModal.svelte'

  let {
    items,
    discount,
    customer,
    oncustomer,
    ondone,
    onclose,
  }: {
    items: CartItem[]
    discount: number
    customer: Customer | null
    oncustomer: (c: Customer) => void
    ondone: (sale: Sale, cashTendered: number | undefined) => void
    onclose: () => void
  } = $props()

  type Pay = 'dinheiro' | 'pix' | 'debito' | 'credito' | 'pix_online' | 'crediario'
  const options = $derived<Pay[]>(
    session.pixOnline
      ? ['dinheiro', 'pix_online', 'pix', 'debito', 'credito', 'crediario']
      : ['dinheiro', 'pix', 'debito', 'credito', 'crediario'],
  )

  const subtotal = $derived(round2(items.reduce((s, i) => s + i.unit_price * i.quantity, 0)))
  const total = $derived(round2(subtotal - discount))

  let payment = $state<Pay>('dinheiro')
  let tendered = $state('')
  // Crediário
  let count = $state(1)
  let days = $state(30)
  let firstDue = $state(dueDateIso(todayIso(), 30, 1))
  let downPayment = $state('')
  let downType = $state<'dinheiro' | 'pix' | 'debito' | 'credito' | 'pix_online'>('dinheiro')

  let saving = $state(false)
  let error = $state('')
  let pickingCustomer = $state(false)
  let pix = $state<PixCharge | null>(null)
  let pendingSale: Sale | null = null
  // Uma chave por venda: repetir o Confirmar depois de uma queda não grava duas vezes.
  const attempt = new Attempt()

  const cash = $derived(parseMoney(tendered))
  const change = $derived(payment === 'dinheiro' && cash > total ? round2(cash - total) : 0)
  const down = $derived(parseMoney(downPayment))
  const financed = $derived(round2(Math.max(0, total - down)))
  const plan = $derived(splitInstallments(financed, Math.max(1, Math.min(60, Number(count) || 1))))
  const schedule = $derived(
    plan.map((amount, i) => ({ label: `${i + 1}/${plan.length}`, due: firstDue ? dueDateIso(firstDue, days, i) : '', amount })),
  )

  const INTERVALS: [number, string][] = [
    [30, 'Mensal'],
    [15, 'Quinzenal'],
    [7, 'Semanal'],
  ]

  function setInterval(d: number) {
    days = d
    firstDue = dueDateIso(todayIso(), d, 1)
  }

  const weekday = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  }

  const problem = $derived.by(() => {
    if (total <= 0) return 'O total precisa ser maior que zero.'
    if (payment === 'dinheiro' && tendered.trim() && cash + 0.004 < total) return 'Valor recebido menor que o total.'
    if (payment === 'crediario') {
      if (!customer) return 'Crediário precisa de um cliente.'
      if (!(Number(count) >= 1 && Number(count) <= 60)) return 'Parcelas: de 1 a 60.'
      if (!(Number(days) >= 1 && Number(days) <= 365)) return 'Intervalo: de 1 a 365 dias.'
      if (firstDue && firstDue < todayIso()) return 'O 1º vencimento não pode ser no passado.'
      if (down > 0 && down >= total) return 'A entrada deve ser menor que o total.'
    }
    return ''
  })

  async function confirm() {
    if (saving || problem || pix) return
    saving = true
    error = ''
    const body: Record<string, unknown> = {
      payment_type: payment,
      customer_id: customer?.id ?? null,
      discount: discount || null,
      items: items.map((i) =>
        i.product_id
          ? { product_id: i.product_id, quantity: i.quantity }
          : { description: i.name, unit_price: i.unit_price, quantity: i.quantity },
      ),
    }
    if (payment === 'crediario') {
      Object.assign(body, {
        installment_count: Number(count),
        days_between_installments: Number(days),
        first_due_date: firstDue || null,
        down_payment: down || null,
        down_payment_type: down > 0 ? downType : null,
      })
    }
    try {
      const sale = await session.api.createSale(body, attempt.keyFor(body))
      if (sale.pix) {
        pendingSale = sale
        pix = sale.pix
      } else {
        ondone(sale, payment === 'dinheiro' && cash > 0 ? cash : undefined)
      }
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  async function pixPaid() {
    pix = null
    if (!pendingSale) return
    try {
      ondone(await session.api.sale(pendingSale.id), undefined)
    } catch {
      ondone(pendingSale, undefined)
    }
  }

  function pixCancelled(reason: string) {
    pix = null
    pendingSale = null
    // A venda do Pix foi cancelada: a próxima tentativa é uma venda nova.
    attempt.reset()
    error = `${reason} A venda foi cancelada e o estoque voltou. Escolha outra forma ou gere o Pix de novo.`
  }

  function keydown(e: KeyboardEvent) {
    if (pickingCustomer || pix) return
    const target = e.target as HTMLElement
    const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT'
    const enterSubmits = typing ? target.dataset.submit !== undefined : target?.tagName !== 'BUTTON'
    if (e.key === 'F9' || (e.key === 'Enter' && enterSubmits)) {
      e.preventDefault()
      confirm()
      return
    }
    // Teclas 1–6 escolhem a forma (fora dos campos de texto).
    if (!typing && /^[1-6]$/.test(e.key)) {
      const opt = options[Number(e.key) - 1]
      if (opt) payment = opt
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<Modal title="Finalizar venda" {onclose} width="620px">
  <div class="total">
    <span class="muted">Total</span>
    <strong>{fmt(total)}</strong>
  </div>

  <div class="options">
    {#each options as opt, i (opt)}
      <button class:selected={payment === opt} onclick={() => (payment = opt)}>
        <span>{PAYMENT_LABELS[opt]}</span><kbd>{i + 1}</kbd>
      </button>
    {/each}
  </div>

  {#if payment === 'dinheiro'}
    <div class="grid2">
      <label>
        Valor recebido
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={tendered} inputmode="decimal" placeholder={fmt(total)} autofocus data-submit />
      </label>
      <div class="money-box"><span>Troco</span><strong>{fmt(change)}</strong></div>
    </div>
  {:else if payment === 'pix_online'}
    <p class="muted">Ao confirmar, o QR Code aparece para o cliente pagar. A venda só fecha quando o Pix cair.</p>
  {:else if payment === 'crediario'}
    <div class="row">
      {#if customer}
        <div><span class="muted">Cliente:</span> <strong>{customer.name}</strong></div>
      {:else}
        <div class="alert warn">Escolha o cliente do crediário.</div>
      {/if}
      <span class="spacer"></span>
      <button onclick={() => (pickingCustomer = true)}>{customer ? 'Trocar' : 'Escolher'} cliente</button>
    </div>
    <div class="field">
      <span class="label">Parcelas</span>
      <div class="parcels">
        {#each Array.from({ length: 12 }, (_, i) => i + 1) as n (n)}
          <button class:selected={count === n} onclick={() => (count = n)}>
            <strong>{n}×</strong>
            <small>{fmt(round2(financed / n))}</small>
          </button>
        {/each}
      </div>
    </div>
    <div class="grid2">
      <div class="field">
        <span class="label">Intervalo</span>
        <div class="intervals">
          {#each INTERVALS as [d, name] (d)}
            <button class:selected={days === d} onclick={() => setInterval(d)}>{name}</button>
          {/each}
        </div>
      </div>
      <label>1º vencimento <input type="date" min={todayIso()} bind:value={firstDue} /></label>
    </div>
    <div class="grid2">
      <label>Entrada (opcional) <input bind:value={downPayment} inputmode="decimal" placeholder="R$ 0,00" data-submit /></label>
      <label>
        Forma da entrada
        <select bind:value={downType} disabled={down <= 0}>
          <option value="dinheiro">Dinheiro</option>
          {#if session.pixOnline}<option value="pix_online">Pix (QR)</option>{/if}
          <option value="pix">Pix</option>
          <option value="debito">Débito</option>
          <option value="credito">Crédito</option>
        </select>
      </label>
    </div>
    {#if schedule.length && !problem}
      <div class="schedule">
        {#if down > 0}
          <div><span>Entrada</span><span class="muted">hoje · recebida agora</span><strong>{fmt(down)}</strong></div>
        {/if}
        {#each schedule as s (s.label)}
          <div>
            <span>{s.label}</span>
            <span class="muted">{#if s.due}{fmtDate(s.due)} · {weekday(s.due)}{/if}</span>
            <strong>{fmt(s.amount)}</strong>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="muted">Confirme depois que o pagamento passar na maquininha ou cair na conta.</p>
  {/if}

  {#if problem}<div class="alert warn">{problem}</div>{/if}
  {#if error}<div class="alert">{error}</div>{/if}

  {#snippet footer()}
    <button onclick={onclose}>Voltar</button>
    <button class="primary big" onclick={confirm} disabled={saving || !!problem}>
      {saving ? 'Gravando…' : payment === 'pix_online' ? 'Gerar Pix' : 'Confirmar venda'}<kbd>F9</kbd>
    </button>
  {/snippet}
</Modal>

{#if pickingCustomer}
  <CustomerPicker
    onclose={() => (pickingCustomer = false)}
    onpick={(c) => {
      oncustomer(c)
      pickingCustomer = false
    }}
  />
{/if}

{#if pix}
  <PixModal charge={pix} onpaid={pixPaid} oncancelled={pixCancelled} />
{/if}

<style>
  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .total span {
    font-size: 14px;
    font-weight: 600;
  }
  .total strong {
    font-size: 40px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .options button {
    height: 52px;
    border-radius: 14px;
    justify-content: space-between;
    font-weight: 700;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
  }
  .parcels {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }
  .parcels button {
    height: 52px;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 0 4px;
    border-radius: 12px;
  }
  .parcels strong {
    font-size: 14px;
    font-weight: 800;
  }
  .parcels small {
    font-size: 10px;
    font-weight: 600;
    opacity: 0.75;
  }
  .intervals {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .intervals button {
    padding: 0 4px;
    font-weight: 700;
  }
  .schedule {
    max-height: 168px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 14px;
  }
  .schedule div {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 7px 14px;
    font-size: 13px;
    border-bottom: 1px solid var(--line-soft);
  }
  .schedule div:last-child {
    border-bottom: 0;
  }
  .schedule span:first-child {
    width: 64px;
    font-weight: 700;
  }
  .schedule .muted {
    flex: 1;
    font-size: 12px;
  }
</style>
