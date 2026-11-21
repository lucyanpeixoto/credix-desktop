<script lang="ts">
  import type { CreditLimit, Customer, PixCharge, Sale } from '../api'
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
    limit = null,
    consignmentId = null,
    oncustomer,
    ondone,
    onclose,
  }: {
    /** Limite do crediário do cliente; passar dele só avisa, não bloqueia. */
    limit?: CreditLimit | null
    /** Venda das peças que ficaram de um condicional: o servidor encerra ele junto. */
    consignmentId?: string | null
    items: CartItem[]
    discount: number
    /** Cliente da venda; com saldo de vale-troca, ele abate o total. */
    customer: Customer | null
    oncustomer: (c: Customer) => void
    ondone: (sale: Sale, cashTendered: number | undefined) => void
    onclose: () => void
  } = $props()

  type Pay = 'dinheiro' | 'pix' | 'debito' | 'credito' | 'pix_online' | 'misto' | 'crediario'
  const options = $derived<Pay[]>(
    session.pixOnline
      ? ['dinheiro', 'pix_online', 'pix', 'debito', 'credito', 'misto', 'crediario']
      : ['dinheiro', 'pix', 'debito', 'credito', 'misto', 'crediario'],
  )

  const subtotal = $derived(round2(items.reduce((s, i) => s + i.unit_price * i.quantity, 0)))
  const total = $derived(round2(subtotal - discount))

  // Vale-troca do cliente: já vem abatendo; o caixa pode não usar.
  const balance = $derived(round2(Math.max(0, customer?.credit_balance ?? 0)))
  let useCredit = $state(true)
  const credit = $derived(useCredit && customer ? round2(Math.min(balance, total)) : 0)
  /** O que o cliente paga agora, depois do vale. */
  const due = $derived(round2(total - credit))

  // Pagamento misto: de 2 a 4 formas. A última linha vazia completa o que falta.
  type Split = 'dinheiro' | 'pix' | 'debito' | 'credito'
  const SPLITS: Split[] = ['dinheiro', 'pix', 'debito', 'credito']
  let parts = $state<{ type: Split; amount: string }[]>([
    { type: 'dinheiro', amount: '' },
    { type: 'credito', amount: '' },
  ])
  const typedSum = $derived(round2(parts.slice(0, -1).reduce((s, p) => s + parseMoney(p.amount), 0)))
  const lastAuto = $derived(round2(Math.max(0, due - typedSum)))
  const partAmounts = $derived(parts.map((p, i) => (i === parts.length - 1 && !p.amount.trim() ? lastAuto : parseMoney(p.amount))))
  const partsSum = $derived(round2(partAmounts.reduce((s, v) => s + v, 0)))
  const cashPart = $derived(round2(parts.reduce((s, p, i) => s + (p.type === 'dinheiro' ? partAmounts[i] : 0), 0)))
  /** No misto com dinheiro: quanto o cliente deu em notas, para o troco. */
  let splitTendered = $state('')
  const splitCash = $derived(parseMoney(splitTendered))
  const splitChange = $derived(cashPart > 0 && splitCash > cashPart ? round2(splitCash - cashPart) : 0)

  function addPart() {
    if (parts.length >= 4) return
    const used = new Set(parts.map((p) => p.type))
    parts.push({ type: SPLITS.find((t) => !used.has(t)) ?? 'credito', amount: '' })
  }

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
  const change = $derived(payment === 'dinheiro' && cash > due ? round2(cash - due) : 0)
  const down = $derived(parseMoney(downPayment))
  const financed = $derived(round2(Math.max(0, due - down)))
  // O vale paga tudo: fecha sem receber nada (em "Dinheiro", com zero).
  const paidByCredit = $derived(total > 0 && due <= 0)
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

  const overLimit = $derived(payment === 'crediario' && limit?.limit != null && limit.used + financed > limit.limit + 0.004)

  const problem = $derived.by(() => {
    if (total <= 0) return 'O total precisa ser maior que zero.'
    if (paidByCredit) return ''
    if (payment === 'dinheiro' && tendered.trim() && cash + 0.004 < due) return 'Valor recebido menor que o total.'
    if (payment === 'misto') {
      if (partAmounts.some((v) => v <= 0)) return 'Informe o valor de cada forma (ou tire a linha).'
      if (Math.abs(partsSum - due) >= 0.005)
        return partsSum < due ? `Falta ${fmt(round2(due - partsSum))} para fechar.` : `Passou ${fmt(round2(partsSum - due))} do total.`
      if (splitTendered.trim() && splitCash + 0.004 < cashPart) return 'Dinheiro recebido menor que a parte em dinheiro.'
    }
    if (payment === 'crediario') {
      if (!customer) return 'Crediário precisa de um cliente.'
      if (!(Number(count) >= 1 && Number(count) <= 60)) return 'Parcelas: de 1 a 60.'
      if (!(Number(days) >= 1 && Number(days) <= 365)) return 'Intervalo: de 1 a 365 dias.'
      if (firstDue && firstDue < todayIso()) return 'O 1º vencimento não pode ser no passado.'
      if (down > 0 && down >= due) return 'A entrada deve ser menor que o total.'
    }
    return ''
  })

  async function confirm() {
    if (saving || problem || pix) return
    saving = true
    error = ''
    const type: Pay = paidByCredit ? 'dinheiro' : payment
    const body: Record<string, unknown> = {
      payment_type: type,
      customer_id: customer?.id ?? null,
      use_credit: credit > 0 || null,
      discount: discount || null,
      consignment_id: consignmentId,
      items: items.map((i) =>
        i.product_id
          ? { product_id: i.product_id, product_variant_id: i.variant_id ?? null, quantity: i.quantity }
          : { description: i.name, unit_price: i.unit_price, quantity: i.quantity },
      ),
    }
    if (type === 'misto') {
      body.methods = parts.map((p, i) => ({ type: p.type, amount: partAmounts[i] }))
    }
    if (type === 'crediario') {
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
        ondone(sale, type === 'dinheiro' && cash > 0 ? cash : type === 'misto' && splitCash > 0 ? splitCash : undefined)
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
    // Teclas 1–7 escolhem a forma; com o cursor num campo (onde o número é valor), Alt+1–7.
    const digit = e.altKey ? e.code.match(/^(?:Digit|Numpad)([1-7])$/)?.[1] : !typing && /^[1-7]$/.test(e.key) ? e.key : undefined
    if (digit) {
      const opt = options[Number(digit) - 1]
      if (opt) {
        e.preventDefault()
        payment = opt
      }
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<Modal title="Finalizar venda" {onclose} width="620px">
  <div class="total">
    <span class="muted">{credit > 0 ? 'A pagar' : 'Total'}</span>
    <strong>{fmt(due)}</strong>
  </div>

  {#if balance > 0 && customer}
    <label class="credit" class:off={!useCredit}>
      <input type="checkbox" bind:checked={useCredit} />
      <span>
        Vale-troca de {customer.name.split(' ')[0]}: <strong>{fmt(balance)}</strong>
        {#if useCredit}· abate {fmt(credit)} de {fmt(total)}{#if balance > credit}{' '}· sobram {fmt(round2(balance - credit))}{/if}{/if}
      </span>
    </label>
  {/if}

  {#if paidByCredit}
    <div class="alert ok">O vale-troca paga a venda inteira. Confirme para fechar sem receber nada.</div>
  {:else}
  <div class="options" title="Com o cursor num campo de valor, use Alt + o número">
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
  {:else if payment === 'misto'}
    <div class="parts">
      {#each parts as part, i (i)}
        <div class="part">
          <select bind:value={part.type} aria-label="Forma {i + 1}">
            {#each SPLITS as t (t)}<option value={t}>{PAYMENT_LABELS[t]}</option>{/each}
          </select>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:value={part.amount}
            inputmode="decimal"
            placeholder={i === parts.length - 1 ? `${fmt(lastAuto)} (o que falta)` : 'R$ 0,00'}
            autofocus={i === 0}
            data-submit
          />
          {#if parts.length > 2}
            <button class="ghost" onclick={() => parts.splice(i, 1)} aria-label="Tirar esta forma">×</button>
          {/if}
        </div>
      {/each}
      {#if parts.length < 4}<button class="ghost add" onclick={addPart}>+ outra forma</button>{/if}
    </div>
    {#if cashPart > 0}
      <div class="grid2">
        <label>Dinheiro recebido <input bind:value={splitTendered} inputmode="decimal" placeholder={fmt(cashPart)} data-submit /></label>
        <div class="money-box"><span>Troco</span><strong>{fmt(splitChange)}</strong></div>
      </div>
    {/if}
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
  {/if}

  {#if overLimit && limit}
    <div class="alert warn">
      Passa do limite de crédito de {fmt(limit.limit ?? 0)}: o cliente já tem {fmt(limit.used)} em aberto e ficaria com {fmt(round2(limit.used + financed))}.
    </div>
  {/if}
  {#if problem}<div class="alert warn">{problem}</div>{/if}
  {#if error}<div class="alert">{error}</div>{/if}

  {#snippet footer()}
    <button onclick={onclose}>Voltar</button>
    <button class="primary big" onclick={confirm} disabled={saving || !!problem}>
      {saving ? 'Gravando…' : payment === 'pix_online' && !paidByCredit ? 'Gerar Pix' : 'Confirmar venda'}<kbd>F9</kbd>
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
  .credit {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--ok-bg);
    color: var(--ok);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .credit.off {
    background: #f8fafc;
    color: var(--muted);
  }
  .credit input {
    width: 18px;
    height: 18px;
  }
  .parts {
    display: grid;
    gap: 8px;
  }
  .part {
    display: grid;
    grid-template-columns: 150px 1fr auto;
    gap: 8px;
  }
  .part .ghost {
    width: 40px;
    padding: 0;
    font-size: 18px;
  }
  .parts .add {
    justify-self: start;
    height: 34px;
    color: var(--brand);
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
