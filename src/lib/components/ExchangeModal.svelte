<script lang="ts">
  // Troca no caixa (Ctrl+T): acha a venda (número, cliente ou a etiqueta da
  // peça), escolhe o que volta e o valor vira vale-troca do cliente, que já
  // abate a venda nova. Nenhum dinheiro sai do caixa.
  import { tick } from 'svelte'
  import type { Customer, ExchangePlan, Sale, SaleDetail } from '../api'
  import { Attempt } from '../attempt'
  import { fmt, round2 } from '../money'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import CustomerPicker from './CustomerPicker.svelte'
  import Modal from './Modal.svelte'

  let {
    onclose,
    ondone,
  }: {
    onclose: () => void
    /** Troca feita: o cliente (com o saldo novo) e quanto virou vale. */
    ondone: (customer: Customer, credit: number) => void
  } = $props()

  const REASONS = ['Tamanho', 'Cor', 'Defeito', 'Não gostou']

  let step = $state<'find' | 'items'>('find')
  let searchEl = $state<HTMLInputElement>()
  let search = $state('')
  let sales = $state<Sale[]>([])
  let active = $state(0)
  let loading = $state(false)
  let error = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  let sale = $state<SaleDetail | null>(null)
  let qty = $state<Record<string, number>>({})
  let reason = $state('')
  let customer = $state<Customer | null>(null)
  let pickingCustomer = $state(false)
  let plan = $state<ExchangePlan | null>(null)
  let saving = $state(false)
  const attempt = new Attempt()
  let planSeq = 0

  const lines = $derived(
    (sale?.items ?? [])
      .filter((i) => i.id)
      .map((i) => ({ ...i, id: i.id!, left: i.quantity - (i.returned_quantity ?? 0) }))
      .filter((i) => i.left > 0),
  )
  const picked = $derived(Object.values(qty).reduce((s, n) => s + n, 0))

  load()

  function onInput() {
    clearTimeout(timer)
    timer = setTimeout(load, 250)
  }

  async function load() {
    const mine = ++seq
    loading = true
    error = ''
    try {
      const res = await session.api.sales({ scope: 'troca', search: search.trim() || undefined })
      if (mine !== seq) return
      sales = res.data
      active = 0
    } catch (e) {
      if (mine === seq) error = (e as Error).message
    } finally {
      if (mine === seq) loading = false
    }
  }

  async function open(s: Sale) {
    error = ''
    try {
      sale = await session.api.sale(s.id)
      qty = {}
      plan = null
      customer = sale.customer ? ({ ...sale.customer, cpf_formatted: sale.customer.cpf_formatted ?? null, phone_formatted: sale.customer.phone_formatted ?? null, code: sale.customer.code ?? null } as Customer) : null
      step = 'items'
      // Uma peça só: já vem marcada.
      if (lines.length === 1 && lines[0].left === 1) setQty(lines[0].id, 1)
    } catch (e) {
      error = (e as Error).message
    }
  }

  function setQty(id: string, n: number) {
    const line = lines.find((l) => l.id === id)
    if (!line) return
    qty = { ...qty, [id]: Math.max(0, Math.min(line.left, n)) }
    refreshPlan()
  }

  async function refreshPlan() {
    if (!sale || !picked) {
      plan = null
      return
    }
    const mine = ++planSeq
    try {
      const res = await session.api.exchangePreview(sale.id, qty)
      if (mine === planSeq) plan = res
    } catch (e) {
      if (mine === planSeq) error = (e as Error).message
    }
  }

  async function confirm() {
    if (!sale || !picked || saving) return
    if (!customer) {
      pickingCustomer = true
      return
    }
    saving = true
    error = ''
    const body = { quantities: qty, customer_id: sale.customer ? null : customer.id, reason: reason || null }
    try {
      const res = await session.api.exchange(sale.id, body, attempt.keyFor({ sale: sale.id, ...body }))
      attempt.reset()
      ondone(res.customer ?? customer, res.credit)
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  function findKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(0, Math.min(sales.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      clearTimeout(timer)
      if (sales[active]) open(sales[active])
      else load()
    }
  }

  async function back() {
    step = 'find'
    sale = null
    await tick()
    searchEl?.focus()
  }
</script>

<Modal title={step === 'find' ? 'Troca: de qual venda?' : `Troca da venda #${sale?.code}`} {onclose} width="620px">
  {#if step === 'find'}
    <label class="find">
      <span class="lens"><Icon name="search" size={18} /></span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={searchEl}
        bind:value={search}
        oninput={onInput}
        onkeydown={findKeydown}
        autofocus
        autocomplete="off"
        spellcheck="false"
        placeholder="Passe a etiqueta da peça, o número da venda ou o nome do cliente"
      />
    </label>
    {#if error}<div class="alert">{error}</div>{/if}
    <div class="list">
      {#each sales as s, i (s.id)}
        <button class:on={i === active} onclick={() => open(s)}>
          <span class="who">
            <strong>#{s.code} · {s.customer?.name ?? 'Consumidor'}</strong>
            <small>{s.created_at_formatted} · {s.payment_label ?? s.payment_type}</small>
          </span>
          <strong>{fmt(s.total)}</strong>
        </button>
      {:else}
        <p class="muted">{loading ? 'Buscando…' : 'Nenhuma venda dos últimos 90 dias com essa busca.'}</p>
      {/each}
    </div>
  {:else if sale}
    <p class="muted">
      {sale.created_at_formatted} · {sale.customer?.name ?? 'sem cliente'} · {fmt(sale.total)}. Marque o que o cliente está devolvendo.
    </p>
    <div class="items">
      {#each lines as l (l.id)}
        <div class="item" class:on={(qty[l.id] ?? 0) > 0}>
          <span class="who">
            <strong>{l.product_name}</strong>
            <small>{l.variant_label && !l.product_name.includes(l.variant_label) ? `${l.variant_label} · ` : ''}{fmt(l.unit_price)} · comprou {l.quantity}{l.returned_quantity ? `, já devolveu ${l.returned_quantity}` : ''}</small>
          </span>
          <div class="stepper">
            <button onclick={() => setQty(l.id, (qty[l.id] ?? 0) - 1)} aria-label="Menos"><Icon name="minus" size={14} /></button>
            <span>{qty[l.id] ?? 0}</span>
            <button onclick={() => setQty(l.id, (qty[l.id] ?? 0) + 1)} aria-label="Mais"><Icon name="plus" size={14} /></button>
          </div>
        </div>
      {:else}
        <p class="muted">Tudo desta venda já foi devolvido.</p>
      {/each}
    </div>

    <div class="reasons">
      <span class="muted">Motivo:</span>
      {#each REASONS as r (r)}
        <button class:on={reason === r} onclick={() => (reason = reason === r ? '' : r)}>{r}</button>
      {/each}
    </div>

    <div class="row">
      {#if customer}
        <span>Vale-troca para <strong>{customer.name}</strong></span>
      {:else}
        <span class="alert warn">Venda sem cliente: escolha quem fica com o vale.</span>
      {/if}
      <span class="spacer"></span>
      {#if !sale.customer}
        <button onclick={() => (pickingCustomer = true)}>{customer ? 'Trocar' : 'Escolher'} cliente</button>
      {/if}
    </div>

    {#if plan}
      <div class="plan">
        <div><span>Peças devolvidas</span><strong>{fmt(plan.total)}</strong></div>
        {#if plan.debt > 0}<div><span>Abate das parcelas em aberto</span><strong>{fmt(plan.debt)}</strong></div>{/if}
        <div class="big"><span>Vira vale-troca</span><strong>{fmt(round2(plan.credit))}</strong></div>
      </div>
    {/if}
    {#if error}<div class="alert">{error}</div>{/if}
  {/if}

  {#snippet footer()}
    {#if step === 'items'}
      <button onclick={back}>Voltar</button>
      <button class="primary big" disabled={!picked || saving} onclick={confirm}>
        {saving ? 'Gravando…' : customer ? 'Trocar e voltar à venda' : 'Escolher cliente'}
      </button>
    {:else}
      <button onclick={onclose}>Fechar</button>
    {/if}
  {/snippet}
</Modal>

{#if pickingCustomer}
  <CustomerPicker
    onclose={() => (pickingCustomer = false)}
    onpick={(c) => {
      customer = c
      pickingCustomer = false
    }}
  />
{/if}

<style>
  .find {
    position: relative;
    display: block;
  }
  .find input {
    height: 50px;
    padding-left: 42px;
    font-size: 15px;
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
  .list,
  .items {
    display: grid;
    gap: 6px;
    max-height: 340px;
    overflow: auto;
  }
  .list button {
    height: auto;
    min-height: 52px;
    padding: 8px 14px;
    justify-content: space-between;
    text-align: left;
  }
  .list button.on {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px rgb(37 99 235 / 15%);
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .who small {
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .item.on {
    border-color: var(--brand);
    background: var(--brand-50);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .stepper button {
    width: 34px;
    height: 34px;
    padding: 0;
  }
  .stepper span {
    min-width: 22px;
    text-align: center;
    font-weight: 800;
  }
  .reasons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .reasons button {
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 13px;
  }
  .reasons button.on {
    background: var(--brand);
    border-color: var(--brand);
    color: #fff;
  }
  .plan {
    display: grid;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 12px;
    background: #f8fafc;
  }
  .plan div {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .plan .big {
    font-size: 16px;
    color: var(--ok);
  }
</style>
