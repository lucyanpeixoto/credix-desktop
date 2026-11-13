<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { ApiError, type Customer, type Product, type Sale } from '../api'
  import { fromProduct, newKey, parseQuantityPrefix, subtotalOf, type CartItem } from '../cart'
  import Checkout from '../components/Checkout.svelte'
  import CustomerPicker from '../components/CustomerPicker.svelte'
  import Modal from '../components/Modal.svelte'
  import { modalStack } from '../components/modalStack'
  import { fmt, fmtDate, PAYMENT_LABELS, parseMoney, round2, toInput } from '../money'
  import { printSale, type PrintResult } from '../print'
  import { printerReady } from '../printer'
  import { session } from '../session.svelte'

  let { active }: { active: boolean } = $props()

  // Venda em andamento
  let items = $state<CartItem[]>([])
  let customer = $state<Customer | null>(null)
  let sellerId = $state<string | null>(null)
  let discount = $state(0)
  let notes = $state('')

  // Busca
  let searchEl = $state<HTMLInputElement>()
  let search = $state('')
  let results = $state<Product[]>([])
  let highlighted = $state(-1)
  let searching = $state(false)
  let flash = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  // Modais
  let modal = $state<'' | 'customer' | 'custom' | 'discount' | 'checkout' | 'done' | 'clear'>('')
  let custom = $state({ name: '', price: '', quantity: 1 })
  let discountInput = $state('')
  let discountPercent = $state(false)
  let done = $state<{ sale: Sale; cashTendered?: number; print?: PrintResult } | null>(null)

  let sellers = $state<{ id: string; name: string }[]>([])

  const subtotal = $derived(subtotalOf(items))
  const total = $derived(round2(Math.max(0, subtotal - discount)))
  const count = $derived(items.reduce((s, i) => s + i.quantity, 0))

  onMount(async () => {
    sellerId = session.user?.id ?? null
    if (!session.isSeller) {
      try {
        sellers = await session.api.sellers()
      } catch {
        sellers = []
      }
    }
  })

  $effect(() => {
    if (active && !modal) focusSearch()
  })

  // O desconto não pode passar do subtotal quando itens saem do carrinho.
  $effect(() => {
    if (discount > subtotal) discount = subtotal
  })

  async function focusSearch() {
    await tick()
    searchEl?.focus()
  }

  function say(kind: 'ok' | 'error', text: string) {
    flash = { kind, text }
    setTimeout(() => {
      if (flash?.text === text) flash = null
    }, kind === 'error' ? 4000 : 1500)
  }

  function onSearchInput() {
    clearTimeout(timer)
    highlighted = -1
    const { term } = parseQuantityPrefix(search)
    // Só números: provavelmente leitor de código de barras, que termina com Enter.
    if (term.length < 2 || /^\d{6,}$/.test(term)) {
      results = []
      return
    }
    timer = setTimeout(() => loadResults(term), 220)
  }

  async function loadResults(term: string) {
    const mine = ++seq
    searching = true
    try {
      const res = await session.api.products(term, 10)
      if (mine === seq) results = res.data
    } catch (e) {
      if (mine === seq) say('error', (e as Error).message)
    } finally {
      if (mine === seq) searching = false
    }
  }

  function add(p: Product, quantity: number) {
    const existing = items.find((i) => i.product_id === p.id)
    if (existing) {
      existing.quantity += quantity
      // Leva o item para o fim, onde o caixa está olhando.
      items = [...items.filter((i) => i !== existing), existing]
    } else {
      items = [...items, fromProduct(p, quantity)]
    }
    say('ok', `${quantity > 1 ? `${quantity}× ` : ''}${p.name}`)
    search = ''
    results = []
    highlighted = -1
  }

  async function submitSearch() {
    clearTimeout(timer)
    const { quantity, term } = parseQuantityPrefix(search)
    if (!term) return
    if (highlighted >= 0 && results[highlighted]) return add(results[highlighted], quantity)

    // Enter: primeiro o código exato (leitor), depois a busca por nome.
    try {
      const res = await session.api.productBySku(term)
      return add(res.data, quantity)
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) return say('error', (e as Error).message)
    }
    const mine = ++seq
    try {
      const res = await session.api.products(term, 10)
      if (mine !== seq) return
      if (res.data.length === 1) return add(res.data[0], quantity)
      results = res.data
      highlighted = res.data.length ? 0 : -1
      if (!res.data.length) say('error', `Nenhum produto com “${term}”.`)
    } catch (e) {
      say('error', (e as Error).message)
    }
  }

  function searchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitSearch()
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      highlighted = Math.min(highlighted + 1, results.length - 1)
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault()
      highlighted = Math.max(highlighted - 1, -1)
    } else if (e.key === 'Escape' && (search || results.length)) {
      e.preventDefault()
      e.stopPropagation()
      search = ''
      results = []
    }
  }

  function setQty(item: CartItem, q: number) {
    if (!Number.isFinite(q) || q < 1) q = 1
    item.quantity = Math.min(9999, Math.floor(q))
  }

  function remove(item: CartItem) {
    items = items.filter((i) => i !== item)
    focusSearch()
  }

  function openCustom() {
    custom = { name: '', price: '', quantity: 1 }
    modal = 'custom'
  }

  function saveCustom(e: SubmitEvent) {
    e.preventDefault()
    const price = parseMoney(custom.price)
    if (!custom.name.trim() || price <= 0) return
    items = [
      ...items,
      { key: newKey(), product_id: null, name: custom.name.trim(), sku: null, unit_price: price, quantity: Math.max(1, Number(custom.quantity) || 1) },
    ]
    modal = ''
  }

  function openDiscount() {
    discountInput = toInput(discount)
    discountPercent = false
    modal = 'discount'
  }

  const discountValue = $derived.by(() => {
    const v = parseMoney(discountInput)
    return round2(discountPercent ? (subtotal * Math.min(v, 100)) / 100 : v)
  })

  function saveDiscount(e: SubmitEvent) {
    e.preventDefault()
    if (discountValue > subtotal) return
    discount = discountValue
    modal = ''
  }

  function reset() {
    items = []
    customer = null
    discount = 0
    notes = ''
    sellerId = session.user?.id ?? null
    search = ''
    results = []
  }

  async function finished(sale: Sale, cashTendered: number | undefined) {
    const seller = sellers.find((s) => s.id === sellerId)?.name
    done = { sale, cashTendered }
    modal = 'done'
    reset()
    const cashIn = sale.payment_type === 'dinheiro' || (sale.installments ?? []).some((i) => i.status === 'paid')
    if (session.settings.autoPrint && printerReady(session.settings)) {
      done.print = await printSale(sale, { cashTendered, seller, drawer: cashIn })
    }
  }

  async function reprint() {
    if (!done) return
    done.print = await printSale(done.sale, { cashTendered: done.cashTendered })
  }

  function windowKeydown(e: KeyboardEvent) {
    if (!active || modalStack.open) return
    const map: Record<string, () => void> = {
      F3: focusSearch,
      F4: openCustom,
      F6: () => (modal = 'customer'),
      F7: () => items.length && openDiscount(),
      F10: () => items.length && (modal = 'checkout'),
    }
    const fn = map[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    } else if (e.key === 'Delete' && e.ctrlKey && items.length) {
      e.preventDefault()
      modal = 'clear'
    }
  }

  function doneKeydown(e: KeyboardEvent) {
    if (modal !== 'done') return
    if (e.key === 'Enter') {
      e.preventDefault()
      modal = ''
    } else if (e.key.toLowerCase() === 'p') {
      e.preventDefault()
      reprint()
    }
  }
</script>

<svelte:window onkeydown={(e) => (windowKeydown(e), doneKeydown(e))} />

<div class="screen">
  <section class="left">
    <div class="search panel">
      <input
        bind:this={searchEl}
        bind:value={search}
        oninput={onSearchInput}
        onkeydown={searchKeydown}
        placeholder="Código de barras, código ou nome do produto  (3*código para quantidade)"
        autocomplete="off"
        spellcheck="false"
      />
      {#if flash}
        <div class="flash {flash.kind}">{flash.text}</div>
      {/if}
      {#if results.length}
        <div class="results">
          {#each results as p, i (p.id)}
            <button class="result" class:hl={i === highlighted} onclick={() => add(p, parseQuantityPrefix(search).quantity)} onmouseenter={() => (highlighted = i)}>
              <span>
                <strong>{p.name}</strong>
                <span class="muted small">{p.sku ?? ''}{#if p.stock !== null} · estoque {p.stock}{/if}</span>
              </span>
              <span class="num">{fmt(p.price)}</span>
            </button>
          {/each}
        </div>
      {:else if searching}
        <div class="results muted small pad">Buscando…</div>
      {/if}
    </div>

    <div class="cart panel">
      {#if items.length}
        <table>
          <thead>
            <tr><th>#</th><th>Produto</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Total</th><th></th></tr>
          </thead>
          <tbody>
            {#each items as item, i (item.key)}
              <tr>
                <td class="muted">{i + 1}</td>
                <td>
                  {item.name}
                  {#if !item.product_id}<span class="badge">avulso</span>{/if}
                  {#if item.sku}<div class="muted small">{item.sku}</div>{/if}
                </td>
                <td class="num">
                  <div class="qty">
                    <button class="ghost" onclick={() => setQty(item, item.quantity - 1)} disabled={item.quantity <= 1}>−</button>
                    <input type="number" min="1" value={item.quantity} onchange={(e) => setQty(item, Number(e.currentTarget.value))} />
                    <button class="ghost" onclick={() => setQty(item, item.quantity + 1)}>+</button>
                  </div>
                </td>
                <td class="num">{fmt(item.unit_price)}</td>
                <td class="num"><strong>{fmt(round2(item.unit_price * item.quantity))}</strong></td>
                <td><button class="ghost danger" onclick={() => remove(item)} aria-label="Remover">✕</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="empty">
          <p><strong>Caixa livre</strong></p>
          <p class="muted">Passe o produto no leitor ou digite o nome.</p>
        </div>
      {/if}
    </div>
  </section>

  <aside class="right">
    <div class="panel box">
      <div class="row">
        <span class="muted">Cliente</span>
        <span class="spacer"></span>
        <button class="ghost small" onclick={() => (modal = 'customer')}>{customer ? 'Trocar' : 'Escolher'}<kbd>F6</kbd></button>
      </div>
      {#if customer}
        <div class="row">
          <strong>{customer.name}</strong>
          <span class="spacer"></span>
          <button class="ghost danger small" onclick={() => (customer = null)}>remover</button>
        </div>
        {#if customer.overdue_count}<span class="badge late">{customer.overdue_count} parcela(s) em atraso</span>{/if}
      {:else}
        <span class="muted small">Consumidor (opcional, obrigatório no crediário)</span>
      {/if}

      {#if sellers.length > 1}
        <label>
          Vendedor
          <select bind:value={sellerId}>
            {#each sellers as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
      {/if}
    </div>

    <div class="panel box totals">
      <div class="row"><span class="muted">Itens</span><span class="spacer"></span><span>{count}</span></div>
      <div class="row"><span class="muted">Subtotal</span><span class="spacer"></span><span class="num">{fmt(subtotal)}</span></div>
      <div class="row">
        <button class="ghost link" onclick={openDiscount} disabled={!items.length}>Desconto<kbd>F7</kbd></button>
        <span class="spacer"></span>
        <span class="num">{discount ? `−${fmt(discount)}` : fmt(0)}</span>
      </div>
      <div class="grand"><span>Total</span><strong>{fmt(total)}</strong></div>
    </div>

    <div class="actions">
      <button class="success big" disabled={!items.length} onclick={() => (modal = 'checkout')}>Finalizar venda<kbd>F10</kbd></button>
      <div class="grid2">
        <button onclick={openCustom}>Item avulso<kbd>F4</kbd></button>
        <button class="danger" disabled={!items.length} onclick={() => (modal = 'clear')}>Cancelar<kbd>Ctrl+Del</kbd></button>
      </div>
    </div>
  </aside>
</div>

{#if modal === 'customer'}
  <CustomerPicker
    onclose={() => (modal = '')}
    onpick={(c) => {
      customer = c
      modal = ''
    }}
  />
{:else if modal === 'custom'}
  <Modal title="Item avulso" onclose={() => (modal = '')} width="460px">
    <form id="custom" class="form" onsubmit={saveCustom}>
      <!-- svelte-ignore a11y_autofocus -->
      <label>Descrição <input bind:value={custom.name} maxlength="255" required autofocus /></label>
      <div class="grid2">
        <label>Preço <input bind:value={custom.price} inputmode="decimal" placeholder="R$ 0,00" required /></label>
        <label>Quantidade <input type="number" min="1" bind:value={custom.quantity} /></label>
      </div>
    </form>
    {#snippet footer()}
      <button onclick={() => (modal = '')}>Voltar</button>
      <button class="primary" type="submit" form="custom">Adicionar</button>
    {/snippet}
  </Modal>
{:else if modal === 'discount'}
  <Modal title="Desconto" onclose={() => (modal = '')} width="420px">
    <form id="discount" class="form" onsubmit={saveDiscount}>
      <div class="row">
        <button type="button" class:primary={!discountPercent} onclick={() => (discountPercent = false)}>R$</button>
        <button type="button" class:primary={discountPercent} onclick={() => (discountPercent = true)}>%</button>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={discountInput} inputmode="decimal" autofocus placeholder={discountPercent ? '10' : 'R$ 0,00'} />
      </div>
      <p class="muted">Desconto de {fmt(discountValue)} · total fica {fmt(Math.max(0, subtotal - discountValue))}</p>
      {#if discountValue > subtotal}<div class="alert warn">O desconto passa do subtotal.</div>{/if}
    </form>
    {#snippet footer()}
      <button onclick={() => (modal = '')}>Voltar</button>
      <button class="primary" type="submit" form="discount" disabled={discountValue > subtotal}>Aplicar</button>
    {/snippet}
  </Modal>
{:else if modal === 'clear'}
  <Modal title="Cancelar venda?" onclose={() => (modal = '')} width="400px">
    <p>Os {items.length} item(ns) do carrinho serão descartados. Nada foi gravado ainda.</p>
    {#snippet footer()}
      <button onclick={() => (modal = '')}>Voltar</button>
      <button
        class="danger"
        onclick={() => {
          reset()
          modal = ''
        }}>Descartar</button
      >
    {/snippet}
  </Modal>
{:else if modal === 'checkout'}
  <Checkout
    {items}
    {discount}
    {customer}
    sellerId={session.isSeller ? null : sellerId}
    {notes}
    oncustomer={(c) => (customer = c)}
    ondone={finished}
    onclose={() => (modal = '')}
  />
{:else if modal === 'done' && done}
  <Modal title={`Venda #${done.sale.code} concluída`} onclose={() => (modal = '')} width="460px">
    <div class="done">
      <div class="row"><span class="muted">Total</span><span class="spacer"></span><strong>{fmt(done.sale.total)}</strong></div>
      <div class="row"><span class="muted">Pagamento</span><span class="spacer"></span><span>{PAYMENT_LABELS[done.sale.payment_type]}</span></div>
      {#if done.cashTendered && done.cashTendered > done.sale.total}
        <div class="troco">Troco <strong>{fmt(done.cashTendered - done.sale.total)}</strong></div>
      {/if}
      {#if done.sale.payment_type === 'crediario' && done.sale.installments?.length}
        <div class="muted small">
          {done.sale.installments.length} parcela(s), última em {fmtDate(done.sale.installments[done.sale.installments.length - 1].due_date)}
        </div>
      {/if}
      {#if done.print}
        <div class="alert" class:ok={done.print.ok}>{done.print.ok ? 'Cupom impresso.' : `Não imprimiu: ${done.print.message}`}</div>
      {/if}
    </div>
    {#snippet footer()}
      <button onclick={reprint} disabled={!printerReady(session.settings)}>Imprimir<kbd>P</kbd></button>
      <button class="primary" onclick={() => (modal = '')}>Nova venda<kbd>Enter</kbd></button>
    {/snippet}
  </Modal>
{/if}

<style>
  .screen {
    height: 100%;
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 14px;
    padding: 14px;
    min-height: 0;
  }
  .left {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 14px;
    min-height: 0;
  }
  .search {
    position: relative;
    padding: 10px;
  }
  .search input {
    font-size: 20px;
    padding: 14px 16px;
  }
  .flash {
    position: absolute;
    right: 22px;
    top: 22px;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--ok-bg);
    color: var(--ok);
    pointer-events: none;
  }
  .flash.error {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .results {
    position: absolute;
    left: 10px;
    right: 10px;
    top: calc(100% - 4px);
    z-index: 10;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 12px 30px rgb(0 0 0 / 12%);
    max-height: 50vh;
    overflow: auto;
  }
  .pad {
    padding: 12px;
  }
  .result {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
    border: 0;
    border-radius: 0;
    border-bottom: 1px solid var(--line);
  }
  .result span {
    display: grid;
  }
  .result.hl {
    background: #eef4ff;
  }
  .cart {
    overflow: auto;
    min-height: 0;
  }
  .empty {
    height: 100%;
    display: grid;
    place-content: center;
    text-align: center;
    font-size: 18px;
  }
  .qty {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .qty input {
    width: 64px;
    text-align: center;
    padding: 6px;
  }
  .qty button {
    padding: 4px 8px;
  }
  .right {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 14px;
    min-height: 0;
  }
  .box {
    padding: 14px;
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .totals {
    align-content: end;
  }
  .link {
    padding: 0;
    color: var(--brand);
  }
  .grand {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .grand strong {
    font-size: 38px;
  }
  .actions {
    display: grid;
    gap: 10px;
  }
  .actions .big {
    padding: 18px;
    font-size: 19px;
  }
  .form {
    display: grid;
    gap: 12px;
  }
  .done {
    display: grid;
    gap: 10px;
  }
  .troco {
    text-align: center;
    font-size: 18px;
    padding: 12px;
    border-radius: 8px;
    background: var(--ok-bg);
    color: var(--ok);
  }
  .troco strong {
    display: block;
    font-size: 34px;
  }
  .small {
    font-size: 12px;
  }
</style>
