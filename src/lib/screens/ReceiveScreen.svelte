<script lang="ts">
  import { untrack } from 'svelte'
  import type { Customer, PixCharge, Receipt, Receivable } from '../api'
  import { Attempt } from '../attempt'
  import CustomerPicker from '../components/CustomerPicker.svelte'
  import Modal from '../components/Modal.svelte'
  import { modalStack } from '../components/modalStack'
  import PixModal from '../components/PixModal.svelte'
  import { fmt, fmtDate, PAYMENT_LABELS, parseMoney, round2, toInput } from '../money'
  import { printReceipt, type PrintResult } from '../print'
  import { printerReady } from '../printer'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  let { active }: { active: boolean } = $props()

  type Method = 'dinheiro' | 'pix' | 'debito' | 'credito'
  const METHODS: Method[] = ['dinheiro', 'pix', 'debito', 'credito']

  let customer = $state<Customer | null>(null)
  let data = $state<Receivable | null>(null)
  let loading = $state(false)
  let error = $state('')

  // O que receber: parcelas marcadas, ou um valor livre abatido das mais antigas.
  let selected = $state<string[]>([])
  let amountInput = $state('')
  let waive = $state(false)
  let discountInput = $state('')
  let notes = $state('')

  // Como recebe
  let usePixOnline = $state(false)
  let rows = $state<{ type: Method; amount: string }[]>([{ type: 'dinheiro', amount: '' }])
  let tenderedInput = $state('')

  let saving = $state(false)
  let pix = $state<PixCharge | null>(null)
  let modal = $state<'' | 'customer' | 'done'>('')
  let done = $state<{ receipt: Receipt; customer: string; print?: PrintResult } | null>(null)
  let copied = $state(false)

  // Uma chave por recebimento: repetir depois de uma queda não baixa as parcelas duas vezes.
  const attempt = new Attempt()

  let previewTimer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  const amount = $derived(data?.preview.amount ?? 0)
  const discount = $derived(parseMoney(discountInput))
  const toPay = $derived(round2(Math.max(0, amount - discount)))
  const typedAmount = $derived(parseMoney(amountInput))
  const dueNow = $derived(data ? data.total_due : 0)

  // Com uma forma só, ela leva o valor todo.
  const rowAmounts = $derived(rows.length === 1 ? [toPay] : rows.map((r) => parseMoney(r.amount)))
  const methodsTotal = $derived(round2(rowAmounts.reduce((s, v) => s + v, 0)))
  const cashAmount = $derived(round2(rows.reduce((s, r, i) => s + (r.type === 'dinheiro' ? rowAmounts[i] : 0), 0)))
  const tendered = $derived(parseMoney(tenderedInput))
  const change = $derived(cashAmount > 0 && tendered > cashAmount ? round2(tendered - cashAmount) : 0)

  const problem = $derived.by(() => {
    if (!data) return ''
    if (!data.installments.length) return 'Este cliente não tem parcelas em aberto.'
    if (amount <= 0) return 'Informe o valor ou marque as parcelas.'
    if (!selected.length && typedAmount > 0 && typedAmount > dueNow + 0.004)
      return `O valor passa do que o cliente deve (${fmt(dueNow)}).`
    if (discount > 0 && discount >= amount) return 'O desconto precisa ser menor que o valor.'
    if (!usePixOnline && Math.abs(methodsTotal - toPay) > 0.004)
      return `As formas somam ${fmt(methodsTotal)}; faltam ${fmt(round2(toPay - methodsTotal))}.`
    if (!usePixOnline && tenderedInput.trim() && tendered + 0.004 < cashAmount) return 'Valor entregue menor que o dinheiro.'
    return ''
  })

  function query() {
    return {
      amount: selected.length ? undefined : typedAmount || undefined,
      installment_ids: selected.length ? selected : undefined,
      waive_surcharge: waive || undefined,
    }
  }

  async function loadCustomer(c: Customer) {
    customer = c
    modal = ''
    resetForm()
    data = null
    loading = true
    error = ''
    const mine = ++seq
    try {
      const res = await session.api.receivable(c.id)
      if (mine !== seq) return
      data = res
      amountInput = toInput(res.total_due)
    } catch (e) {
      if (mine === seq) error = (e as Error).message
    } finally {
      if (mine === seq) loading = false
    }
  }

  function refreshPreview() {
    if (!customer) return
    clearTimeout(previewTimer)
    previewTimer = setTimeout(async () => {
      const mine = ++seq
      try {
        const res = await session.api.receivable(customer!.id, query())
        if (mine === seq) {
          data = res
          error = ''
        }
      } catch (e) {
        if (mine === seq) error = (e as Error).message
      }
    }, 250)
  }

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    refreshPreview()
  }

  function resetForm() {
    selected = []
    amountInput = ''
    waive = false
    discountInput = ''
    notes = ''
    usePixOnline = false
    rows = [{ type: 'dinheiro', amount: '' }]
    tenderedInput = ''
  }

  function addRow() {
    const left = round2(toPay - methodsTotal)
    if (rows.length === 1) rows[0].amount = toInput(toPay)
    rows = [...rows, { type: rows.some((r) => r.type === 'pix') ? 'debito' : 'pix', amount: left > 0 ? toInput(left) : '' }]
  }

  function removeRow(i: number) {
    rows = rows.filter((_, j) => j !== i)
  }

  /** Dias até o vencimento (0 = hoje). */
  function daysTo(iso: string): number {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    const due = new Date(y, m - 1, d).getTime()
    const t = new Date()
    return Math.round((due - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86_400_000)
  }

  const paidPreview = (id: string) => data?.preview.rows.find((r) => r.installment_id === id)

  async function confirm() {
    if (!data || !customer || saving || problem || pix) return
    saving = true
    error = ''
    const common = {
      customer_id: customer.id,
      amount,
      waive_surcharge: waive,
      discount: discount || null,
      installment_ids: selected.length ? selected : null,
      notes: notes.trim() || null,
    }
    try {
      if (usePixOnline) {
        pix = await session.api.createPix(common, attempt.keyFor(['pix', common]))
      } else {
        const body = {
          ...common,
          methods: rows.map((r, i) => ({ type: r.type, amount: rowAmounts[i] })),
          cash_tendered: cashAmount > 0 && tenderedInput.trim() ? tendered : null,
        }
        finish(await session.api.receive(body, attempt.keyFor(body)))
      }
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  async function finish(receipt: Receipt) {
    const name = customer?.name ?? ''
    attempt.reset()
    done = { receipt, customer: name }
    modal = 'done'
    session.loadCash()
    customer = null
    data = null
    resetForm()
    const cashIn = receipt.methods.some((m) => m.type === 'dinheiro')
    if (session.settings.autoPrint && printerReady(session.settings)) {
      done.print = await printReceipt(receipt, name, cashIn)
    }
  }

  function pixPaid(c: PixCharge) {
    pix = null
    if (c.receipt) finish(c.receipt)
    else {
      attempt.reset()
      error = 'Pix pago. O recebimento está sendo registrado; confira o cliente em instantes.'
      if (customer) loadCustomer(customer)
    }
  }

  async function copyWhatsapp() {
    if (!done?.receipt.whatsapp_message) return
    try {
      await navigator.clipboard.writeText(done.receipt.whatsapp_message)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      // ignorado
    }
  }

  function keydown(e: KeyboardEvent) {
    if (!active) return
    if (modal === 'done') {
      if (e.key === 'Enter') {
        e.preventDefault()
        modal = ''
      } else if (e.key.toLowerCase() === 'p' && done) {
        e.preventDefault()
        printReceipt(done.receipt, done.customer).then((r) => done && (done.print = r))
      }
      return
    }
    if (modalStack.open) return
    if (e.key === 'F4' || (e.key === 'F3' && !customer)) {
      e.preventDefault()
      modal = 'customer'
    } else if (e.key === 'F9') {
      e.preventDefault()
      confirm()
    }
  }

  // Ao entrar na aba sem cliente, já abre a busca (uma vez; fechar não reabre).
  $effect(() => {
    if (active) untrack(() => !customer && !modal && (modal = 'customer'))
  })
</script>

<svelte:window onkeydown={keydown} />

<div class="screen">
  <section class="panel left">
    <header class="row">
      {#if customer}
        <span class="avatar big">{customer.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
        <div class="who">
          <h2>{customer.name}</h2>
          <span class="muted small">
            {[customer.cpf_formatted, customer.phone_formatted, customer.code ? `#${customer.code}` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        {#if data}
          <div class="due">
            <span>Devido hoje</span>
            <strong>{fmt(data.total_due)}</strong>
          </div>
        {/if}
      {:else}
        <span class="avatar big"><Icon name="user" size={22} /></span>
        <h2 class="muted who">Escolha o cliente</h2>
      {/if}
      <button onclick={() => (modal = 'customer')}>{customer ? 'Trocar cliente' : 'Buscar cliente'} <kbd>F4</kbd></button>
    </header>

    {#if loading}
      <p class="muted pad">Carregando parcelas…</p>
    {:else if data}
      {#if data.installments.length}
        <div class="table">
          <table>
            <thead>
              <tr>
                <th></th><th>Venda</th><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Juros/multa</th><th class="num">Abate</th>
              </tr>
            </thead>
            <tbody>
              {#each data.installments as i (i.id)}
                {@const p = paidPreview(i.id)}
                <tr class:hit={!!p} onclick={() => toggle(i.id)}>
                  <td><input type="checkbox" checked={selected.includes(i.id)} onclick={(e) => e.stopPropagation()} onchange={() => toggle(i.id)} /></td>
                  <td>#{i.sale_code}</td>
                  <td>{i.is_down_payment ? 'Entrada' : `${i.installment_number}ª`}</td>
                  <td>
                    {fmtDate(i.due_date)}
                    {#if i.days_late > 0}<span class="badge late">{i.days_late}d atraso</span>
                    {:else if daysTo(i.due_date) <= 7}<span class="badge soon">vence em {daysTo(i.due_date)}d</span>
                    {:else}<span class="badge">em dia</span>{/if}
                  </td>
                  <td class="num">{fmt(i.principal)}</td>
                  <td class="num">{i.surcharge ? fmt(i.surcharge) : '—'}</td>
                  <td class="num">
                    {#if p}{fmt(p.principal_paid + p.surcharge_paid)}{#if p.settled} ✓{/if}{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <footer class="row muted small pad">
          {selected.length ? `${selected.length} parcela(s) marcada(s)` : 'Sem parcelas marcadas: o valor abate das mais antigas.'}
          <span class="spacer"></span>
          Total devido hoje: <strong>{fmt(data.total_due)}</strong>
        </footer>
      {:else}
        <p class="pad">Este cliente não tem parcelas em aberto. 🎉</p>
      {/if}
    {:else}
      <p class="muted pad">Busque o cliente para ver as parcelas em aberto.</p>
    {/if}
  </section>

  <aside class="right">
    <div class="panel box">
      <label>
        Valor a receber
        <input
          bind:value={amountInput}
          oninput={refreshPreview}
          inputmode="decimal"
          disabled={!data || selected.length > 0}
          placeholder={selected.length ? 'Pelas parcelas marcadas' : 'R$ 0,00'}
        />
      </label>
      {#if data?.permissions.waive_surcharge && (data.preview.surcharge > 0 || data.preview.waived > 0 || waive)}
        <label class="check"><input type="checkbox" bind:checked={waive} onchange={refreshPreview} /> Dispensar juros e multa</label>
      {/if}
      {#if data?.permissions.discount}
        <label>Desconto <input bind:value={discountInput} inputmode="decimal" placeholder="R$ 0,00" disabled={!data} /></label>
      {/if}
      {#if data}
        <div class="sum">
          <div class="row"><span class="muted">Principal</span><span class="spacer"></span>{fmt(data.preview.principal)}</div>
          {#if data.preview.surcharge > 0}<div class="row"><span class="muted">Juros/multa</span><span class="spacer"></span>{fmt(data.preview.surcharge)}</div>{/if}
          {#if data.preview.waived > 0}<div class="row"><span class="muted">Dispensado</span><span class="spacer"></span>−{fmt(data.preview.waived)}</div>{/if}
          {#if discount > 0}<div class="row"><span class="muted">Desconto</span><span class="spacer"></span>−{fmt(discount)}</div>{/if}
          <div class="grand"><span>A pagar</span><strong>{fmt(toPay)}</strong></div>
        </div>
      {/if}
    </div>

    <div class="panel box">
      <div class="methods">
        {#each METHODS as m (m)}
          <button
            class:selected={!usePixOnline && rows.length === 1 && rows[0].type === m}
            disabled={!data}
            onclick={() => {
              usePixOnline = false
              rows = [{ type: m, amount: '' }]
            }}>{PAYMENT_LABELS[m]}</button
          >
        {/each}
        {#if data?.pix_online}
          <button class:selected={usePixOnline} onclick={() => (usePixOnline = true)}>Pix (QR)</button>
        {/if}
      </div>

      {#if !usePixOnline && data}
        {#if rows.length > 1}
          {#each rows as r, i (i)}
            <div class="row">
              <select bind:value={r.type}>
                {#each METHODS as m (m)}<option value={m}>{PAYMENT_LABELS[m]}</option>{/each}
              </select>
              <input bind:value={r.amount} inputmode="decimal" placeholder="R$ 0,00" />
              <button class="ghost danger" onclick={() => removeRow(i)} aria-label="Remover">✕</button>
            </div>
          {/each}
        {/if}
        <button class="ghost link" onclick={addRow}>+ Dividir em outra forma</button>
        {#if cashAmount > 0}
          <div class="grid2">
            <label>Valor entregue <input bind:value={tenderedInput} inputmode="decimal" placeholder={fmt(cashAmount)} /></label>
            <div class="money-box"><span>Troco</span><strong>{fmt(change)}</strong></div>
          </div>
        {/if}
      {:else if usePixOnline}
        <p class="muted small">O QR Code aparece para o cliente pagar. A baixa é feita quando o Pix cair.</p>
      {/if}

      <label>Observação <input bind:value={notes} maxlength="500" disabled={!data} /></label>
    </div>

    {#if problem && data}<div class="alert warn">{problem}</div>{/if}
    {#if error}<div class="alert">{error}</div>{/if}

    <button class="primary big" disabled={!data || !!problem || saving} onclick={confirm}>
      {saving ? 'Gravando…' : usePixOnline ? 'Gerar Pix' : 'Confirmar recebimento'}<kbd>F9</kbd>
    </button>
  </aside>
</div>

{#if modal === 'customer'}
  <CustomerPicker onpick={loadCustomer} onclose={() => (modal = '')} />
{:else if modal === 'done' && done}
  <Modal title={`Recebimento #${done.receipt.code}`} onclose={() => (modal = '')} width="460px">
    <div class="done">
      <div class="row"><span class="muted">Cliente</span><span class="spacer"></span><strong>{done.customer}</strong></div>
      <div class="row"><span class="muted">Recebido</span><span class="spacer"></span><strong>{fmt(done.receipt.total)}</strong></div>
      {#each done.receipt.methods.filter((m) => m.type !== 'desconto') as m, i (i)}
        <div class="row muted small"><span>{PAYMENT_LABELS[m.type] ?? m.type}</span><span class="spacer"></span>{fmt(m.amount)}</div>
      {/each}
      {#if done.receipt.change > 0}
        <div class="troco">Troco <strong>{fmt(done.receipt.change)}</strong></div>
      {/if}
      {#if done.print}
        <div class="alert" class:ok={done.print.ok}>{done.print.ok ? 'Comprovante impresso.' : `Não imprimiu: ${done.print.message}`}</div>
      {/if}
    </div>
    {#snippet footer()}
      {#if done?.receipt.whatsapp_message}
        <button onclick={copyWhatsapp}>{copied ? 'Copiado!' : 'Copiar p/ WhatsApp'}</button>
      {/if}
      <button
        disabled={!printerReady(session.settings)}
        onclick={() => done && printReceipt(done.receipt, done.customer).then((r) => done && (done.print = r))}>Imprimir<kbd>P</kbd></button
      >
      <button class="primary" onclick={() => (modal = '')}>Novo<kbd>Enter</kbd></button>
    {/snippet}
  </Modal>
{/if}

{#if pix}
  <PixModal
    charge={pix}
    onpaid={pixPaid}
    oncancelled={(reason) => {
      pix = null
      attempt.reset()
      error = reason
    }}
  />
{/if}

<style>
  .screen {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  .left {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    margin: 20px 24px;
    min-height: 0;
    overflow: hidden;
  }
  .left > header {
    padding: 16px;
    gap: 14px;
    border-bottom: 1px solid var(--line-soft);
  }
  .avatar.big {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    font-size: 16px;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  h2 {
    font-size: 18px;
    font-weight: 800;
  }
  .due {
    display: grid;
    justify-items: end;
  }
  .due span {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .due strong {
    font-size: 22px;
    font-weight: 800;
  }
  .table {
    overflow: auto;
    min-height: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-soft);
    font-size: 14px;
    font-weight: 600;
  }
  td .badge {
    margin-left: 6px;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: #f8fafc;
  }
  tbody tr.hit {
    background: var(--brand-50);
  }
  td.num:last-child {
    color: var(--ok);
    font-weight: 800;
  }
  .pad {
    padding: 14px 16px;
  }
  footer.pad {
    border-top: 1px solid var(--line-soft);
  }
  .right {
    width: 420px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    background: #fff;
    border-left: 1px solid var(--line);
    overflow: auto;
    min-height: 0;
  }
  .right > .panel {
    border: 0;
    padding: 0;
  }
  .box {
    display: grid;
    gap: 10px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ink-2);
    font-size: 13px;
    font-weight: 600;
  }
  .sum {
    display: grid;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .grand {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-top: 1px solid var(--line-soft);
    padding-top: 10px;
    margin-top: 4px;
    color: #475569;
    font-size: 14px;
    font-weight: 700;
  }
  .grand strong {
    font-size: 38px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--ink);
    line-height: 1;
  }
  .methods {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .methods button {
    height: 48px;
    font-weight: 700;
  }
  .link {
    height: auto;
    padding: 0;
    justify-self: start;
    color: var(--brand);
    font-weight: 700;
    font-size: 13px;
  }
  .big {
    margin-top: auto;
  }
  .done {
    display: grid;
    gap: 8px;
  }
  .troco {
    text-align: center;
    padding: 12px;
    border-radius: 14px;
    background: var(--ok-bg);
    color: var(--ok);
    font-weight: 700;
  }
  .troco strong {
    display: block;
    font-size: 30px;
    font-weight: 800;
  }
</style>
