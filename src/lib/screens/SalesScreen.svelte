<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { Sale, SaleDetail, SaleFilters } from '../api'
  import { Attempt } from '../attempt'
  import Modal from '../components/Modal.svelte'
  import { modalStack } from '../components/modalStack'
  import { fmt, fmtDate, PAYMENT_LABELS, todayIso } from '../money'
  import { printCarne, printSale, type PrintResult } from '../print'
  import { printerReady } from '../printer'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  let { active }: { active: boolean } = $props()

  const STATUS: Record<string, { label: string; cls: string }> = {
    completed: { label: 'Paga', cls: 'ok' },
    pending: { label: 'Em aberto', cls: 'soon' },
    cancelled: { label: 'Cancelada', cls: 'late' },
  }
  const INST: Record<string, string> = { paid: 'Paga', pending: 'Aberta', partial: 'Parcial', overdue: 'Atrasada', cancelled: 'Cancelada' }

  let searchEl = $state<HTMLInputElement>()
  let date = $state(todayIso())
  let search = $state('')
  let paymentType = $state('')
  let status = $state('')
  let thisTerminal = $state(false)
  let page = $state(1)

  let list = $state<Sale[]>([])
  let summary = $state({ count: 0, total: 0 })
  let lastPage = $state(1)
  let loading = $state(false)
  let error = $state('')
  let hl = $state(0)

  let detail = $state<SaleDetail | null>(null)
  let loadingDetail = $state(false)
  let detailError = $state('')
  let print = $state<PrintResult | null>(null)
  let copied = $state(false)

  // Cancelamento
  const REASONS = ['Cliente desistiu', 'Lançada errada', 'Troca de forma de pagamento', 'Venda duplicada']
  let canceling = $state(false)
  let reason = $state('')
  let cancelBusy = $state(false)
  let cancelError = $state('')
  let cancelled = $state<string | null>(null)
  const cancelAttempt = new Attempt()

  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let dseq = 0
  let wasActive = false

  onMount(load)

  // Ao voltar para a aba, atualiza a lista (pode ter venda nova).
  $effect(() => {
    if (active && !wasActive) {
      load()
      tick().then(() => searchEl?.focus())
    }
    wasActive = active
  })

  function filters(): SaleFilters {
    return {
      date,
      search: search.trim() || undefined,
      payment_type: paymentType || undefined,
      status: status || undefined,
      this_terminal: thisTerminal || undefined,
      page,
    }
  }

  async function load() {
    const mine = ++seq
    loading = true
    error = ''
    try {
      const res = await session.api.sales(filters())
      if (mine !== seq) return
      list = res.data
      summary = res.summary
      lastPage = res.meta?.last_page ?? 1
      hl = 0
      if (list.length === 1 || (detail && !list.some((s) => s.id === detail!.id))) open(list[0])
    } catch (e) {
      if (mine === seq) error = (e as Error).message
    } finally {
      if (mine === seq) loading = false
    }
  }

  function refilter() {
    page = 1
    load()
  }

  function onSearch() {
    clearTimeout(timer)
    timer = setTimeout(refilter, 300)
  }

  async function open(s: Sale | undefined) {
    print = null
    copied = false
    cancelled = null
    if (!s) {
      detail = null
      return
    }
    const mine = ++dseq
    loadingDetail = true
    detailError = ''
    try {
      const d = await session.api.sale(s.id)
      if (mine === dseq) detail = d
    } catch (e) {
      if (mine === dseq) detailError = (e as Error).message
    } finally {
      if (mine === dseq) loadingDetail = false
    }
  }

  function openCancel() {
    reason = ''
    cancelError = ''
    canceling = true
  }

  async function confirmCancel(e?: SubmitEvent) {
    e?.preventDefault()
    if (!detail || cancelBusy || reason.trim().length < 3) return
    cancelBusy = true
    cancelError = ''
    try {
      const why = reason.trim()
      const d = await session.api.cancelSale(detail.id, why, cancelAttempt.keyFor([detail.id, why]))
      cancelAttempt.reset()
      detail = d
      canceling = false
      cancelled = refundHint(d)
      load()
      session.loadCash()
    } catch (err) {
      cancelError = (err as Error).message
    } finally {
      cancelBusy = false
    }
  }

  /** O que fazer com o dinheiro depois de cancelar. */
  function refundHint(d: SaleDetail): string {
    const paid = d.payment_type === 'crediario' ? 0 : d.total
    if (!paid) return 'Venda cancelada. O estoque voltou.'
    const how: Record<string, string> = {
      dinheiro: `Devolva ${fmt(paid)} em dinheiro ao cliente.`,
      pix: `Devolva ${fmt(paid)} por Pix ao cliente.`,
      pix_online: `O Pix de ${fmt(paid)} precisa ser devolvido pelo Mercado Pago.`,
      debito: `Estorne ${fmt(paid)} na maquininha (débito).`,
      credito: `Estorne ${fmt(paid)} na maquininha (crédito).`,
    }
    return `Venda cancelada e estoque devolvido. ${how[d.payment_type] ?? ''}`.trim()
  }

  async function reprint() {
    if (detail) print = await printSale(detail)
  }

  // Carnê na matricial: só no crediário, com as parcelas em aberto.
  let printingCarne = $state(false)
  const canCarne = $derived(
    !!detail && detail.payment_type === 'crediario' && detail.status !== 'cancelled'
      && (detail.installments ?? []).some((i) => i.status !== 'paid' && i.status !== 'cancelled'),
  )
  async function carne() {
    if (!detail || printingCarne) return
    printingCarne = true
    print = await printCarne(detail.id)
    printingCarne = false
  }

  async function copyWhatsapp() {
    if (!detail?.whatsapp_message) return
    try {
      await navigator.clipboard.writeText(detail.whatsapp_message)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      // ignorado
    }
  }

  function keydown(e: KeyboardEvent) {
    if (!active || modalStack.open) return
    const target = e.target as HTMLElement
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault()
      hl = Math.min(hl + 1, list.length - 1)
      open(list[hl])
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault()
      hl = Math.max(hl - 1, 0)
      open(list[hl])
    } else if (e.key === 'F3') {
      e.preventDefault()
      searchEl?.focus()
    } else if (e.key.toLowerCase() === 'p' && detail && target?.tagName !== 'INPUT') {
      e.preventDefault()
      reprint()
    }
  }

  // Navegação por dia (‹ data ›); o calendário nativo abre ao clicar na data.
  let dateEl = $state<HTMLInputElement>()

  function shiftDay(delta: number) {
    const [y, m, d] = date.split('-').map(Number)
    const next = new Date(y, m - 1, d + delta)
    const p = (n: number) => String(n).padStart(2, '0')
    const iso = `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`
    if (iso > todayIso()) return
    date = iso
    refilter()
  }

  function goToday() {
    date = todayIso()
    refilter()
  }

  // No WebKit do macOS o calendário só fecha quando o campo perde o foco; como
  // o campo fica escondido, clicar fora não fechava. Fecha à mão: tira o foco
  // e recria o campo (recriar fecha o calendário em qualquer caso).
  let pickerOpen = false
  let pickerKey = $state(0)

  function pickDate() {
    pickerOpen = true
    dateEl?.focus()
    try {
      dateEl?.showPicker()
    } catch {
      // Sem showPicker: fica o foco no campo.
    }
  }

  function closePicker(e: PointerEvent) {
    if (!pickerOpen || e.target === dateEl) return
    pickerOpen = false
    dateEl?.blur()
    pickerKey++
  }

  function onDateChange() {
    pickerOpen = false
    refilter()
  }

  const dayLabel = $derived.by(() => {
    if (date === todayIso()) return 'Hoje'
    const [y, m, d] = date.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    if (dt.toDateString() === yesterday.toDateString()) return 'Ontem'
    return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  })

  const time = (s: Sale) => s.created_at_formatted.split(' ')[1] ?? s.created_at_formatted
  const isToday = $derived(date === todayIso())
</script>

<svelte:window onkeydown={keydown} onpointerdowncapture={closePicker} />

<div class="screen">
  <section class="listcol">
    <div class="filters">
      <label class="search">
        <span class="lens"><Icon name="search" size={18} /></span>
        <input
          bind:this={searchEl}
          bind:value={search}
          oninput={onSearch}
          placeholder="Número da venda ou nome do cliente"
          aria-label="Buscar venda"
        />
        <kbd>F3</kbd>
      </label>
      <div class="row wrap">
        <div class="day">
          <button class="nav" onclick={() => shiftDay(-1)} aria-label="Dia anterior">‹</button>
          <button class="label" onclick={pickDate} title="Escolher a data">
            <Icon name="calendar" size={15} /> {dayLabel}
          </button>
          <button class="nav" onclick={() => shiftDay(1)} disabled={isToday} aria-label="Próximo dia">›</button>
          {#if !isToday}<button class="today" onclick={goToday}>Hoje</button>{/if}
          {#key pickerKey}
            <input bind:this={dateEl} class="native" type="date" bind:value={date} max={todayIso()} onchange={onDateChange} tabindex="-1" aria-hidden="true" />
          {/key}
        </div>
        <select bind:value={paymentType} onchange={refilter} aria-label="Forma de pagamento">
          <option value="">Todas as formas</option>
          {#each Object.entries(PAYMENT_LABELS).filter(([k]) => !['ajuste', 'desconto'].includes(k)) as [k, v] (k)}
            <option value={k}>{v}</option>
          {/each}
        </select>
        <select bind:value={status} onchange={refilter} aria-label="Situação">
          <option value="">Todas</option>
          <option value="completed">Pagas</option>
          <option value="pending">Em aberto</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <label class="check"><input type="checkbox" bind:checked={thisTerminal} onchange={refilter} /> Só deste caixa</label>
      </div>
    </div>

    <div class="sum">
      <span>{isToday ? 'Hoje' : fmtDate(date)} · {summary.count} {summary.count === 1 ? 'venda' : 'vendas'}</span>
      <strong>{fmt(summary.total)}</strong>
    </div>

    <div class="list">
      {#if error}
        <div class="alert">{error}</div>
      {/if}
      {#each list as s, i (s.id)}
        <button class="item" class:on={detail?.id === s.id} class:cancel={s.status === 'cancelled'} onclick={() => ((hl = i), open(s))}>
          <span class="code">#{s.code}</span>
          <span class="mid">
            <strong>{s.customer?.name ?? 'Consumidor'}</strong>
            <span>{time(s)} · {PAYMENT_LABELS[s.payment_type] ?? s.payment_type}{#if s.seller} · {s.seller.first_name}{/if}</span>
          </span>
          <span class="right">
            <strong>{fmt(s.total)}</strong>
            <span class="badge {STATUS[s.status]?.cls ?? ''}">{STATUS[s.status]?.label ?? s.status}</span>
          </span>
        </button>
      {:else}
        <p class="muted empty">{loading ? 'Carregando vendas…' : 'Nenhuma venda encontrada.'}</p>
      {/each}
    </div>

    {#if lastPage > 1}
      <div class="pager">
        <button disabled={page <= 1} onclick={() => ((page -= 1), load())}>Anterior</button>
        <span class="muted small">Página {page} de {lastPage}</span>
        <button disabled={page >= lastPage} onclick={() => ((page += 1), load())}>Próxima</button>
      </div>
    {/if}
  </section>

  <aside class="detail">
    {#if detailError}
      <div class="alert">{detailError}</div>
    {:else if !detail}
      <div class="none">
        <Icon name="search" size={28} />
        <strong>{loadingDetail ? 'Abrindo…' : 'Escolha uma venda'}</strong>
        <span class="muted">Use ↑ ↓ para passar pelas vendas.</span>
      </div>
    {:else}
      {@const d = detail}
      <div class="dhead">
        <div>
          <h2>Venda #{d.code}</h2>
          <span class="muted small">{d.created_at_formatted}{#if d.terminal} · {d.terminal}{/if}</span>
        </div>
        <span class="badge {STATUS[d.status]?.cls ?? ''}">{STATUS[d.status]?.label ?? d.status}</span>
      </div>

      <div class="scroll">
        <div class="block grid2">
          <div><span class="lbl">Cliente</span><strong>{d.customer?.name ?? 'Consumidor'}</strong>
            {#if d.customer?.cpf_formatted || d.customer?.phone_formatted}<span class="muted small">{[d.customer?.cpf_formatted, d.customer?.phone_formatted].filter(Boolean).join(' · ')}</span>{/if}
          </div>
          <div><span class="lbl">Vendedor</span><strong>{d.seller?.name ?? d.user?.name ?? '—'}</strong></div>
          <div><span class="lbl">Pagamento</span><strong>{PAYMENT_LABELS[d.payment_type] ?? d.payment_type}</strong></div>
          {#if d.payment_type === 'crediario'}
            <div><span class="lbl">Falta pagar</span><strong class:red={(d.remaining_amount ?? 0) > 0}>{fmt(d.remaining_amount)}</strong></div>
          {/if}
        </div>

        <div class="block">
          <span class="lbl">Itens</span>
          {#each d.items ?? [] as it, i (i)}
            <div class="line">
              <span>{it.quantity}× {it.product_name}{#if it.is_custom} <span class="badge">avulso</span>{/if}</span>
              <span class="num">{fmt(it.subtotal)}</span>
            </div>
          {/each}
          {#if d.discount > 0}
            <div class="line muted"><span>Subtotal</span><span class="num">{fmt(d.subtotal)}</span></div>
            <div class="line muted"><span>Desconto</span><span class="num">− {fmt(d.discount)}</span></div>
          {/if}
          <div class="line total"><span>Total</span><span class="num">{fmt(d.total)}</span></div>
        </div>

        {#if d.installments?.length}
          <div class="block">
            <span class="lbl">Parcelas</span>
            {#each d.installments as p (p.id)}
              <div class="line">
                <span>{p.notes === 'Entrada' ? 'Entrada' : `${p.installment_number}ª`} · {fmtDate(p.due_date)}</span>
                <span class="row gap">
                  <span class="badge {p.status === 'paid' ? 'ok' : p.is_overdue ? 'late' : ''}">{p.is_overdue && p.status !== 'paid' ? `${p.days_overdue}d atraso` : (INST[p.status] ?? p.status)}</span>
                  <span class="num">{fmt(p.amount)}</span>
                </span>
              </div>
            {/each}
          </div>
        {/if}

        {#if d.receipts?.length}
          <div class="block">
            <span class="lbl">Recebimentos</span>
            {#each d.receipts as r (r.id)}
              <div class="line">
                <span>
                  #{r.code} · {new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  <span class="muted small">{r.methods.join(', ')}{#if r.received_by} · {r.received_by}{/if}{#if r.status === 'reversed'} · estornado{/if}</span>
                </span>
                <span class="num" class:strike={r.status === 'reversed'}>{fmt(r.amount_on_sale)}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if d.notes}
          <div class="block"><span class="lbl">Observação</span><p>{d.notes}</p></div>
        {/if}

        {#if print}<div class="alert" class:ok={print.ok}>{print.ok ? (print.message ?? 'Cupom impresso.') : `Não imprimiu: ${print.message}`}</div>{/if}
        {#if cancelled}<div class="alert warn">{cancelled}</div>{/if}
      </div>

      <div class="actions">
        {#if d.can_cancel}
          <button class="danger" onclick={openCancel}>Cancelar venda</button>
          <span class="spacer"></span>
        {/if}
        {#if d.whatsapp_message}
          <button onclick={copyWhatsapp}>{copied ? 'Copiado!' : 'Copiar p/ WhatsApp'}</button>
        {/if}
        {#if canCarne}
          <button
            onclick={carne}
            disabled={printingCarne || !session.settings.carnePrinter}
            title={session.settings.carnePrinter ? 'Imprime as parcelas em aberto na matricial' : 'Escolha a impressora do carnê em Configurações (F12)'}
          >
            <Icon name="printer" size={16} /> {printingCarne ? 'Enviando…' : 'Imprimir carnê'}
          </button>
        {/if}
        <button class="primary" onclick={reprint} disabled={!printerReady(session.settings) || d.status === 'cancelled'}>
          <Icon name="printer" size={16} /> Reimprimir <kbd>P</kbd>
        </button>
      </div>
    {/if}
  </aside>
</div>

{#if canceling && detail}
  <Modal title={`Cancelar venda #${detail.code}`} onclose={() => (canceling = false)} width="460px">
    <form id="cancel-sale" class="cform" onsubmit={confirmCancel}>
      <p class="muted">
        {fmt(detail.total)} · {PAYMENT_LABELS[detail.payment_type] ?? detail.payment_type}{#if detail.customer} · {detail.customer.name}{/if}.
        O estoque volta e a venda sai do caixa.
      </p>
      <div class="chips">
        {#each REASONS as r (r)}
          <button type="button" class:selected={reason === r} onclick={() => (reason = r)}>{r}</button>
        {/each}
      </div>
      <!-- svelte-ignore a11y_autofocus -->
      <label>Motivo <input bind:value={reason} maxlength="255" placeholder="Por que está cancelando?" autofocus /></label>
      {#if cancelError}<div class="alert">{cancelError}</div>{/if}
    </form>
    {#snippet footer()}
      <button onclick={() => (canceling = false)}>Voltar</button>
      <button class="primary dangerfill" type="submit" form="cancel-sale" disabled={cancelBusy || reason.trim().length < 3}>
        {cancelBusy ? 'Cancelando…' : 'Cancelar venda'}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .cform {
    display: grid;
    gap: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips button {
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 13px;
  }
  .dangerfill {
    background: var(--danger);
    box-shadow: none;
  }
  .dangerfill:hover:not(:disabled) {
    background: #991b1b;
  }
  .screen {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  .listcol {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 24px;
  }
  .filters {
    display: grid;
    gap: 10px;
  }
  .search {
    position: relative;
    display: block;
  }
  .search input {
    height: 52px;
    border-radius: 14px;
    border-width: 2px;
    padding: 0 60px 0 44px;
    font-size: 16px;
    font-weight: 600;
  }
  .lens {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--faint);
    display: flex;
  }
  .search kbd {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .day {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 220px;
  }
  .day .nav {
    width: 40px;
    padding: 0;
    font-size: 20px;
  }
  .day .label {
    flex: 1;
    gap: 8px;
    text-transform: capitalize;
    color: var(--ink);
  }
  .day .today {
    padding: 0 12px;
    color: var(--brand);
  }
  .day .native {
    position: absolute;
    left: 44px;
    bottom: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .wrap > select {
    width: auto;
    flex: 1 1 150px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ink-2);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .sum {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .sum strong {
    font-size: 20px;
    color: var(--ink);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    gap: 6px;
    align-content: start;
  }
  .item {
    height: auto;
    padding: 12px 14px;
    justify-content: flex-start;
    gap: 14px;
    text-align: left;
    border-radius: 14px;
  }
  .item.on {
    border-color: var(--brand);
    background: var(--brand-50);
  }
  .item.cancel .mid strong,
  .item.cancel .right strong {
    text-decoration: line-through;
    color: var(--faint);
  }
  .code {
    font-weight: 800;
    color: var(--muted);
    min-width: 56px;
  }
  .mid {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .mid strong {
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mid span,
  .small {
    font-size: 12px;
    color: var(--muted);
  }
  .right {
    display: grid;
    justify-items: end;
    gap: 4px;
  }
  .right strong {
    color: var(--ink);
    font-size: 15px;
  }
  .empty {
    padding: 40px 0;
    text-align: center;
  }
  .pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .detail {
    width: 440px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid var(--line);
    min-height: 0;
  }
  .none {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    color: var(--faint);
    text-align: center;
  }
  .none strong {
    color: var(--ink);
  }
  .dhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 18px;
    border-bottom: 1px solid var(--line-soft);
  }
  .dhead > div {
    display: grid;
    gap: 2px;
  }
  h2 {
    font-size: 20px;
    font-weight: 800;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 18px 18px;
  }
  .block {
    padding: 14px 0;
    border-bottom: 1px solid var(--line-soft);
    display: grid;
    gap: 8px;
  }
  .block.grid2 > div {
    display: grid;
    gap: 2px;
  }
  .lbl {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .line > span:first-child {
    display: grid;
  }
  .line.total {
    font-size: 17px;
    font-weight: 800;
    padding-top: 4px;
  }
  .gap {
    gap: 8px;
  }
  .red {
    color: var(--danger);
  }
  .strike {
    text-decoration: line-through;
    color: var(--faint);
  }
  .actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 14px 18px;
    border-top: 1px solid var(--line);
  }
</style>
