<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { ApiError, type Category, type Customer, type Product, type ProductVariant, type Sale } from '../api'
  import { cashDueOf, fromProduct, newKey, parseQuantityPrefix, subtotalOf, type CartItem } from '../cart'
  import Checkout from '../components/Checkout.svelte'
  import CustomerPicker from '../components/CustomerPicker.svelte'
  import Modal from '../components/Modal.svelte'
  import { modalStack } from '../components/modalStack'
  import ExchangeModal from '../components/ExchangeModal.svelte'
  import PriceCheck from '../components/PriceCheck.svelte'
  import { loadHeld, MAX_HELD, saveHeld, type HeldSale } from '../held'
  import { fmt, fmtDate, PAYMENT_LABELS, parseMoney, round2, toInput } from '../money'
  import { canPrintCarne, canPrintReceipt, kickDrawer, printCarne, printSale, type PrintResult } from '../print'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  let { active }: { active: boolean } = $props()

  // Venda em andamento (o vendedor é quem entrou com o PIN)
  let items = $state<CartItem[]>([])
  let customer = $state<Customer | null>(null)
  let discount = $state(0)

  // Catálogo
  let searchEl = $state<HTMLInputElement>()
  let search = $state('')
  let categories = $state<Category[]>([])
  let categoryId = $state<string | null>(null)
  let products = $state<Product[]>([])
  let highlighted = $state(-1)
  let loading = $state(false)
  let flash = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  // Modais
  let modal = $state<'' | 'customer' | 'custom' | 'variant' | 'discount' | 'total' | 'checkout' | 'done' | 'clear' | 'held' | 'lookup' | 'exchange'>('')
  let picking = $state<{ product: Product; quantity: number } | null>(null)

  function pickVariant(v: ProductVariant) {
    const p = picking
    picking = null
    modal = ''
    if (p) add(p.product, p.quantity, v)
  }
  let custom = $state({ name: '', price: '', quantity: 1 })
  let discountInput = $state('')
  let discountPercent = $state(true)
  let totalInput = $state('')
  let done = $state<{ sale: Sale; cashTendered?: number; print?: PrintResult; carne?: PrintResult } | null>(null)
  let printingCarne = $state(false)

  // Carnê na matricial: pelo botão, depois da venda no crediário.
  async function carne() {
    if (!done || printingCarne) return
    printingCarne = true
    done.carne = await printCarne(done.sale)
    printingCarne = false
  }

  const subtotal = $derived(subtotalOf(items))
  const total = $derived(round2(Math.max(0, subtotal - discount)))
  const count = $derived(items.reduce((s, i) => s + i.quantity, 0))
  const qtyOf = (productId: string, variantId: string) =>
    items.find((i) => i.product_id === productId && i.variant_id === variantId)?.quantity ?? 0

  // Soma por produto: com grade, cada tamanho/cor é uma linha do carrinho.
  const qtyById = $derived(
    items.reduce((m, i) => (i.product_id ? m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.quantity) : m), new Map<string, number>()),
  )
  const searching = $derived(parseQuantityPrefix(search).term.length >= 2)
  // Calças em Masculino e em Feminino: o atalho mostra "Calças · Feminino".
  const repeatedNames = $derived(new Set(categories.map((c) => c.name).filter((n, i, all) => all.indexOf(n) !== i)))
  // Servidor antigo não manda o limite: fica o 5 de antes.
  const lowLimit = $derived(session.company?.low_stock_threshold ?? 5)

  // Cards ou lista: fica gravado no computador.
  const listView = $derived(session.settings.catalogView === 'list')
  // Na lista, a grade aparece inteira na linha até este tanto; depois, +N.
  const LIST_VARIANTS = 8

  function setView(view: 'cards' | 'list') {
    if (session.settings.catalogView !== view) session.updateSettings({ ...session.settings, catalogView: view })
    focusSearch()
  }

  // As setas andam pela busca: o destacado fica sempre à vista.
  $effect(() => {
    if (highlighted < 0) return
    tick().then(() => document.querySelector('.catalog .hl')?.scrollIntoView({ block: 'nearest' }))
  })

  const initialsOf = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase()

  onMount(async () => {
    loadProducts()
    try {
      categories = (await session.api.categories()).data.filter((c) => !c.parent_id)
    } catch {
      categories = []
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

  async function loadProducts() {
    const term = parseQuantityPrefix(search).term
    const mine = ++seq
    loading = true
    try {
      const res = await session.api.products(term.length >= 2 ? term : '', 40, term.length >= 2 ? null : categoryId)
      if (mine === seq) {
        products = res.data
        highlighted = term.length >= 2 && res.data.length ? 0 : -1
      }
    } catch (e) {
      if (mine === seq) say('error', (e as Error).message)
    } finally {
      if (mine === seq) loading = false
    }
  }

  function onSearchInput() {
    clearTimeout(timer)
    const { term } = parseQuantityPrefix(search)
    // Só números longos: leitor de código de barras, que termina com Enter.
    if (/^\d{6,}(-\d+)?$/.test(term)) return
    timer = setTimeout(loadProducts, 220)
  }

  function pickCategory(id: string | null) {
    categoryId = id
    search = ''
    loadProducts()
    focusSearch()
  }

  /** Aviso no seletor de grade (leu o código de uma variação que não existe mais). */
  let variantNotice = $state('')

  function add(p: Product, quantity = 1, variant: ProductVariant | null = null, notice = '') {
    // Produto com grade: pergunta o tamanho/cor antes de pôr no carrinho.
    if (p.has_variants && !variant) {
      if (!p.variants?.length) return say('error', `“${p.name}” está com grade, mas sem tamanho/cor cadastrado.`)
      // Com uma variação só não há o que perguntar.
      if (p.variants.length === 1) return add(p, quantity, p.variants[0])
      variantNotice = notice
      picking = { product: p, quantity }
      modal = 'variant'
      return
    }
    const existing = items.find((i) => i.product_id === p.id && (i.variant_id ?? null) === (variant?.id ?? null))
    if (existing) {
      existing.quantity += quantity
      items = [...items.filter((i) => i !== existing), existing]
    } else {
      items = [...items, fromProduct(p, quantity, variant)]
    }
    say('ok', `${quantity > 1 ? `${quantity}× ` : ''}${p.name}${variant ? ` (${variant.label})` : ''}`)
    if (search) {
      search = ''
      loadProducts()
    }
    focusSearch()
  }

  async function submitSearch() {
    clearTimeout(timer)
    const { quantity, term } = parseQuantityPrefix(search)
    if (!term) return
    if (highlighted >= 0 && products[highlighted] && searching) return add(products[highlighted], quantity)

    // Enter: primeiro o código exato (leitor), depois a busca por nome.
    try {
      const res = await session.api.productBySku(term)
      // Código da variação (000023-2): já entra o tamanho/cor certo.
      const variant = res.data.variants?.find((v) => v.id === res.matched_variant_id) ?? null
      const notice = res.variant_missing ? `A variação ${term} não existe mais. Escolha o tamanho/cor.` : ''
      return add(res.data, quantity, variant, notice)
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) return say('error', (e as Error).message)
    }
    await loadProducts()
    if (products.length === 1) return add(products[0], quantity)
    if (!products.length) say('error', `Nenhum produto com “${term}”.`)
  }

  function searchKeydown(e: KeyboardEvent) {
    const cols = listView ? 1 : 4
    if (e.key === 'Enter') {
      e.preventDefault()
      submitSearch()
    } else if (searching && products.length && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault()
      const step = { ArrowDown: cols, ArrowUp: -cols, ArrowLeft: -1, ArrowRight: 1 }[e.key]!
      highlighted = Math.min(products.length - 1, Math.max(0, highlighted + step))
    } else if (e.key === 'Escape' && search) {
      e.preventDefault()
      e.stopPropagation()
      search = ''
      loadProducts()
    }
  }

  function setQty(item: CartItem, q: number) {
    if (!Number.isFinite(q) || q < 1) return remove(item)
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

  // Abre em %; com desconto já aplicado, volta no modo e no valor em que foi dado.
  function openDiscount() {
    if (!discount) {
      discountPercent = true
      discountInput = ''
    } else if (!discountPercent) {
      discountInput = toInput(discount)
    }
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

  // Fechar num total redondo: a diferença para o subtotal vira o desconto, em R$.
  function openTotal() {
    totalInput = toInput(total)
    modal = 'total'
  }

  const newTotal = $derived(parseMoney(totalInput))
  const totalProblem = $derived(
    newTotal <= 0 ? 'Informe o total.' : newTotal > subtotal ? `O total não pode passar do subtotal (${fmt(subtotal)}).` : '',
  )

  function saveTotal(e: SubmitEvent) {
    e.preventDefault()
    if (totalProblem) return
    discount = round2(subtotal - newTotal)
    discountPercent = false
    discountInput = toInput(discount)
    modal = ''
  }

  function reset() {
    items = []
    customer = null
    discount = 0
    search = ''
  }

  // ── Vendas em espera ─────────────────────────────────────────
  let held = $state<HeldSale[]>(loadHeld())

  /** Tira o carrinho do caixa e guarda; o caixa fica livre para o próximo. */
  function holdSale(): boolean {
    if (!items.length) return false
    if (held.length >= MAX_HELD) {
      say('error', `Já há ${MAX_HELD} vendas em espera. Retome ou descarte uma.`)
      return false
    }
    held = [
      { id: newKey(), at: new Date().toISOString(), seller: session.seller?.name ?? null, customer, items: $state.snapshot(items), discount },
      ...held,
    ]
    saveHeld(held)
    say('ok', `Venda em espera${customer ? ` (${customer.name})` : ''}`)
    reset()
    focusSearch()
    return true
  }

  /** Volta a venda ao caixa; a que estava aberta vai para a espera no lugar. */
  function resumeHeld(h: HeldSale) {
    // Sai da lista antes: com a lista cheia, a aberta ainda cabe no lugar dela.
    held = held.filter((x) => x.id !== h.id)
    saveHeld(held)
    holdSale()
    items = h.items
    customer = h.customer
    discount = Math.min(h.discount, subtotalOf(h.items))
    modal = ''
    say('ok', 'Venda retomada')
    focusSearch()
  }

  function dropHeld(h: HeldSale) {
    held = held.filter((x) => x.id !== h.id)
    saveHeld(held)
    if (!held.length) {
      modal = ''
      focusSearch()
    }
  }

  const heldTotal = (h: HeldSale) => round2(Math.max(0, subtotalOf(h.items) - h.discount))
  const heldCount = (h: HeldSale) => h.items.reduce((s, i) => s + i.quantity, 0)
  const heldTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  /** Troca feita: o cliente vem para a venda com o vale, que abate na finalização. */
  function exchanged(c: Customer, credit: number) {
    customer = c
    modal = ''
    say('ok', `Vale-troca de ${fmt(credit)} para ${c.name.split(' ')[0]}. Passe as peças novas.`)
    focusSearch()
  }

  /** Da consulta (F10) direto para o carrinho. */
  function addFromLookup(p: Product, v: ProductVariant | null) {
    modal = ''
    add(p, 1, v)
  }

  async function finished(sale: Sale, cashTendered: number | undefined) {
    done = { sale, cashTendered }
    modal = 'done'
    session.loadCash()
    reset()
    loadProducts()
    const cashIn =
      (sale.payment_type === 'dinheiro' && sale.total - (sale.credit_used ?? 0) > 0) ||
      (sale.payment_methods ?? []).some((m) => m.payment_type === 'dinheiro') ||
      (sale.installments ?? []).some((i) => i.status === 'paid')
    if (session.settings.autoPrint && canPrintReceipt(session.settings)) {
      done.print = await printSale(sale, { cashTendered, drawer: cashIn })
    } else if (cashIn) {
      kickDrawer()
    }
  }

  async function reprint() {
    if (!done) return
    done.print = await printSale(done.sale, { cashTendered: done.cashTendered })
  }

  const ARROW_STEP: Record<string, 'row' | 1 | -1> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 'row', ArrowDown: 'row' }

  function moveVariantFocus(key: string) {
    const grid = document.querySelector<HTMLElement>('.variants')
    const buttons = [...(grid?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (!grid || !buttons.length) return
    // Colunas da grade como estão na tela (3 hoje).
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = ARROW_STEP[key] === 'row' ? (key === 'ArrowUp' ? -cols : cols) : (ARROW_STEP[key] as number)
    const next = current < 0 ? 0 : Math.min(buttons.length - 1, Math.max(0, current + step))
    buttons[next].focus()
  }

  function windowKeydown(e: KeyboardEvent) {
    if (!active) return
    // Teclas 1–9 escolhem o tamanho/cor.
    if (modal === 'variant' && picking && /^[1-9]$/.test(e.key)) {
      const v = picking.product.variants?.[Number(e.key) - 1]
      if (v) {
        e.preventDefault()
        pickVariant(v)
      }
      return
    }
    // Setas andam pela grade de tamanhos/cores; Enter escolhe a destacada.
    if (modal === 'variant' && picking && e.key in ARROW_STEP) {
      e.preventDefault()
      moveVariantFocus(e.key)
      return
    }
    if (modal === 'done') {
      if (e.key === 'Enter') {
        e.preventDefault()
        modal = ''
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault()
        reprint()
      }
      return
    }
    if (modalStack.open) return
    const map: Record<string, () => void> = {
      F3: focusSearch,
      F4: () => (modal = 'customer'),
      F6: openCustom,
      F7: () => items.length && openDiscount(),
      F8: () => items.length && openTotal(),
      F9: () => items.length && (modal = 'checkout'),
      F10: () => (modal = 'lookup'),
    }
    const fn = map[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    } else if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault()
      modal = 'exchange'
    } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
      // Ctrl+E: com carrinho, põe em espera; vazio, abre a lista para retomar.
      e.preventDefault()
      if (items.length) holdSale()
      else if (held.length) modal = 'held'
    } else if (e.key === 'Delete' && e.ctrlKey && items.length) {
      e.preventDefault()
      modal = 'clear'
    }
  }
</script>

<svelte:window onkeydown={windowKeydown} />

<div class="screen">
  <section class="catalog">
    <label class="search">
      <span class="lens"><Icon name="search" size={22} /></span>
      <input
        bind:this={searchEl}
        bind:value={search}
        oninput={onSearchInput}
        onkeydown={searchKeydown}
        aria-label="Buscar produto"
        placeholder="Passe o código de barras ou digite o nome  ·  3*código para quantidade"
        autocomplete="off"
        spellcheck="false"
      />
      {#if flash}
        <span class="flash {flash.kind}">{flash.text}</span>
      {:else}
        <kbd class="hint">F3</kbd>
      {/if}
    </label>

    <div class="toolbar">
      {#if categories.length && !searching}
        <div class="chips">
          <button class:on={!categoryId} onclick={() => pickCategory(null)}>Todos</button>
          {#each categories as c (c.id)}
            <button class:on={categoryId === c.id} onclick={() => pickCategory(c.id)}>{repeatedNames.has(c.name) ? (c.label ?? c.name) : c.name}</button>
          {/each}
        </div>
      {/if}
      <div class="view" role="group" aria-label="Exibição dos produtos">
        <button class:on={!listView} title="Ver em cards" aria-label="Ver em cards" onclick={() => setView('cards')}><Icon name="grid" size={16} /></button>
        <button class:on={listView} title="Ver em lista" aria-label="Ver em lista" onclick={() => setView('list')}><Icon name="list" size={16} /></button>
      </div>
    </div>

    {#snippet variantChip(p: Product, v: ProductVariant)}
      {@const vq = qtyOf(p.id, v.id)}
      <button
        class:selected={!!vq}
        class:out={v.stock <= 0}
        title={v.stock > 0 ? `${v.stock} em estoque` : 'sem estoque'}
        onclick={(e) => {
          e.stopPropagation()
          add(p, 1, v)
        }}
      >
        {v.label}{vq ? '' : ':'} <small>{vq ? `×${vq}` : Math.max(0, v.stock)}</small>
      </button>
    {/snippet}

    <div class="grid-wrap">
      {#if products.length && listView}
        <!-- Lista: uma linha por produto, com a grade inteira à mão. -->
        <div class="list">
          {#each products as p, i (p.id)}
            {@const q = qtyById.get(p.id)}
            {@const grade = p.has_variants && p.variants?.length ? p.variants : []}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="prow" role="button" tabindex="-1" class:incart={!!q} class:hl={searching && i === highlighted} onclick={() => add(p)}>
              <span class="info">
                <span class="name">{p.name}</span>
                {#if p.sku}<span class="sku">SKU {p.sku}</span>{/if}
              </span>
              {#if grade.length}
                <span class="variants-inline">
                  {#each grade.slice(0, LIST_VARIANTS) as v (v.id)}
                    {@render variantChip(p, v)}
                  {/each}
                  {#if grade.length > LIST_VARIANTS}
                    <button class="more" title="Ver todas as variações">+{grade.length - LIST_VARIANTS}</button>
                  {/if}
                </span>
              {/if}
              <span class="stock" class:zero={p.stock !== null && p.stock <= 0} class:low={p.stock !== null && p.stock > 0 && p.stock <= lowLimit}>
                {p.stock !== null ? `estoque ${p.stock}` : ''}
              </span>
              <span class="price">{fmt(p.price)}</span>
              <span class="qty" class:none={!q}>{q ?? ''}</span>
            </div>
          {/each}
        </div>
      {:else if products.length}
        <div class="grid">
          {#each products as p, i (p.id)}
            {@const q = qtyById.get(p.id)}
            {#snippet body()}
              {#if q}<span class="qty">{q}</span>{/if}
              <span class="name">{p.name}</span>
              {#if p.sku}<span class="sku">SKU {p.sku}</span>{/if}
              <span class="bottom">
                <span class="price">{fmt(p.price)}</span>
                {#if p.stock !== null}
                  <span class="stock" class:zero={p.stock <= 0} class:low={p.stock > 0 && p.stock <= lowLimit}>estoque {p.stock}</span>
                {/if}
              </span>
            {/snippet}
            {#if p.has_variants && p.variants?.length}
              <!-- Com grade: um tamanho/cor no card (o primeiro com estoque), que já
                   entra no carrinho; o card e o +N abrem a escolha com todas. -->
              {@const shown = [...p.variants].sort((a, b) => Number(a.stock <= 0) - Number(b.stock <= 0)).slice(0, 1)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div class="product grade" role="button" tabindex="-1" class:incart={!!q} class:hl={searching && i === highlighted} onclick={() => add(p)}>
                {@render body()}
                <span class="variants-inline">
                  {#each shown as v (v.id)}
                    {@render variantChip(p, v)}
                  {/each}
                  {#if p.variants.length > shown.length}
                    <button class="more" title="Ver todas as variações">+{p.variants.length - shown.length}</button>
                  {/if}
                </span>
              </div>
            {:else}
              <button class="product" class:incart={!!q} class:hl={searching && i === highlighted} onclick={() => add(p)}>
                {@render body()}
              </button>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="muted empty">{loading ? 'Carregando produtos…' : searching ? 'Nenhum produto encontrado.' : 'Nenhum produto nesta categoria.'}</p>
      {/if}
    </div>
  </section>

  <aside class="side">
    <div class="customer">
      {#if customer}
        <div class="row">
          <span class="avatar">{initialsOf(customer.name)}</span>
          <div class="who">
            <strong>{customer.name}</strong>
            <span>{customer.cpf_formatted ?? 'sem CPF'}{#if customer.code} · #{customer.code}{/if}</span>
          </div>
          <button class="ghost x" onclick={() => (customer = null)} aria-label="Remover cliente"><Icon name="x" size={16} /></button>
        </div>
        {#if customer.overdue_count}
          <div class="alert warn row"><Icon name="alert" size={16} /> {customer.overdue_count} parcela(s) em atraso</div>
        {/if}
        {#if (customer.credit_balance ?? 0) > 0}
          <div class="alert ok row">Vale-troca de {fmt(customer.credit_balance ?? 0)}: abate na finalização.</div>
        {/if}
      {:else}
        <button class="pick" onclick={() => (modal = 'customer')}>
          <Icon name="user" size={18} />
          <span>Consumidor <span class="muted">· escolher cliente</span></span>
          <kbd>F4</kbd>
        </button>
      {/if}
    </div>

    <div class="cart">
      {#each items as item (item.key)}
        <div class="line">
          <div class="info">
            <strong>{item.name}</strong>
            <span>
              {#if item.variant_label}<b class="variant">{item.variant_label}</b> · {/if}{item.product_id
                ? `${fmt(item.unit_price)} un.`
                : `avulso · ${fmt(item.unit_price)}`}
            </span>
          </div>
          <div class="stepper">
            <button onclick={() => setQty(item, item.quantity - 1)} aria-label="Diminuir"><Icon name="minus" size={16} /></button>
            <span>{item.quantity}</span>
            <button onclick={() => setQty(item, item.quantity + 1)} aria-label="Aumentar"><Icon name="plus" size={16} /></button>
          </div>
          <span class="num total">{fmt(round2(item.unit_price * item.quantity))}</span>
        </div>
      {:else}
        <div class="free">
          <Icon name="cart" size={28} />
          <strong>Caixa livre</strong>
          <span class="muted">Passe o produto no leitor ou toque no produto.</span>
        </div>
      {/each}
    </div>

    <div class="totals">
      <div class="row sub"><span>Subtotal · {count} {count === 1 ? 'item' : 'itens'}</span><span class="spacer"></span><span class="num">{fmt(subtotal)}</span></div>
      <div class="row sub">
        <button class="ghost link" onclick={openDiscount} disabled={!items.length}>Desconto <kbd>F7</kbd></button>
        <span class="spacer"></span>
        <span class="num" class:green={discount > 0}>{discount ? `− ${fmt(discount)}` : fmt(0)}</span>
      </div>
      <div class="grand">
        <span>Total <button class="ghost link" onclick={openTotal} disabled={!items.length}>Alterar <kbd>F8</kbd></button></span>
        <strong>{fmt(total)}</strong>
      </div>
      <button class="primary big" disabled={!items.length} onclick={() => (modal = 'checkout')}>Finalizar venda <kbd>F9</kbd></button>
      <div class="grid2">
        <button onclick={openCustom}>Item avulso <kbd>F6</kbd></button>
        <button class="danger" disabled={!items.length} onclick={() => (modal = 'clear')}>Cancelar <kbd>Ctrl+Del</kbd></button>
      </div>
      <div class="grid2">
        {#if items.length || !held.length}
          <button disabled={!items.length} onclick={holdSale} title="O cliente foi ao provador? Guarde a venda e atenda o próximo.">Pôr em espera <kbd>Ctrl+E</kbd></button>
        {:else}
          <button class="held-on" onclick={() => (modal = 'held')}>Retomar venda <kbd>Ctrl+E</kbd></button>
        {/if}
        <button class:held-on={held.length > 0} disabled={!held.length} onclick={() => (modal = 'held')}>Em espera{held.length ? ` (${held.length})` : ''}</button>
      </div>
      <div class="grid2">
        <button class="ghost link lookup" onclick={() => (modal = 'exchange')}>Troca <kbd>Ctrl+T</kbd></button>
        <button class="ghost link lookup" onclick={() => (modal = 'lookup')}>Consultar <kbd>F10</kbd></button>
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
{:else if modal === 'variant' && picking}
  <Modal
    title={picking.product.name}
    onclose={() => {
      picking = null
      modal = ''
      focusSearch()
    }}
    width="520px"
  >
    {#if variantNotice}<div class="alert warn">{variantNotice}</div>{/if}
    <p class="muted">Escolha o tamanho e a cor{picking.quantity > 1 ? ` (${picking.quantity} unidades)` : ''}: setas e Enter, ou o número.</p>
    <div class="variants">
      {#each picking.product.variants ?? [] as v, i (v.id)}
        <!-- svelte-ignore a11y_autofocus -->
        <button class:out={v.stock <= 0} onclick={() => pickVariant(v)} autofocus={i === 0}>
          <strong>{v.label}</strong>
          <small>{v.stock > 0 ? `${v.stock} em estoque` : 'sem estoque'}</small>
          {#if i < 9}<kbd>{i + 1}</kbd>{/if}
        </button>
      {/each}
    </div>
  </Modal>
{:else if modal === 'discount'}
  <Modal title="Desconto" onclose={() => (modal = '')} width="420px">
    <form id="discount" class="form" onsubmit={saveDiscount}>
      <div class="row">
        <!-- Trocar R$/% limpa o valor: o mesmo número quer dizer outra coisa. -->
        <button type="button" class:selected={!discountPercent} onclick={() => discountPercent && ((discountPercent = false), (discountInput = ''))}>R$</button>
        <button type="button" class:selected={discountPercent} onclick={() => !discountPercent && ((discountPercent = true), (discountInput = ''))}>%</button>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={discountInput}
          inputmode="decimal"
          data-mask={discountPercent ? 'off' : 'money'}
          autofocus
          placeholder={discountPercent ? '10' : 'R$ 0,00'}
        />
      </div>
      <p class="muted">Desconto de {fmt(discountValue)} · total fica {fmt(Math.max(0, subtotal - discountValue))}</p>
      {#if discountValue > subtotal}<div class="alert warn">O desconto passa do subtotal.</div>{/if}
    </form>
    {#snippet footer()}
      <button onclick={() => (modal = '')}>Voltar</button>
      <button class="primary" type="submit" form="discount" disabled={discountValue > subtotal}>Aplicar</button>
    {/snippet}
  </Modal>
{:else if modal === 'total'}
  <Modal title="Alterar total" onclose={() => (modal = '')} width="420px">
    <form id="total" class="form" onsubmit={saveTotal}>
      <label>
        Total da venda
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={totalInput} inputmode="decimal" autofocus placeholder={fmt(total)} onfocus={(e) => e.currentTarget.select()} />
      </label>
      {#if totalProblem}
        <div class="alert warn">{totalProblem}</div>
      {:else}
        <p class="muted">
          Desconto fica {fmt(round2(subtotal - newTotal))}{#if discount > 0 && newTotal !== total}
            ({fmt(discount)} já dado {newTotal < total ? '+' : '−'} {fmt(Math.abs(round2(total - newTotal)))}){/if}.
        </p>
      {/if}
    </form>
    {#snippet footer()}
      <button onclick={() => (modal = '')}>Voltar</button>
      <button class="primary" type="submit" form="total" disabled={!!totalProblem}>Aplicar</button>
    {/snippet}
  </Modal>
{:else if modal === 'exchange'}
  <ExchangeModal
    ondone={exchanged}
    onclose={() => {
      modal = ''
      focusSearch()
    }}
  />
{:else if modal === 'lookup'}
  <PriceCheck
    {lowLimit}
    onadd={addFromLookup}
    onclose={() => {
      modal = ''
      focusSearch()
    }}
  />
{:else if modal === 'held'}
  <Modal
    title="Vendas em espera"
    onclose={() => {
      modal = ''
      focusSearch()
    }}
    width="560px"
  >
    {#if items.length}
      <div class="alert warn">A venda aberta agora vai para a espera no lugar da que você retomar.</div>
    {/if}
    <div class="held">
      {#each held as h (h.id)}
        <div class="held-row">
          <button class="held-pick" onclick={() => resumeHeld(h)}>
            <span class="held-who">
              <strong>{h.customer?.name ?? 'Consumidor'}</strong>
              <small>{heldCount(h)} {heldCount(h) === 1 ? 'peça' : 'peças'} · {h.items.map((i) => i.name).slice(0, 2).join(', ')}{h.items.length > 2 ? '…' : ''}</small>
              <small>{heldTime(h.at)}{h.seller ? ` · ${h.seller}` : ''}</small>
            </span>
            <strong class="num">{fmt(heldTotal(h))}</strong>
          </button>
          <button class="ghost danger" title="Descartar esta venda" aria-label="Descartar" onclick={() => dropHeld(h)}><Icon name="x" size={16} /></button>
        </div>
      {/each}
    </div>
    <p class="muted">O estoque só baixa quando a venda é finalizada. As vendas em espera ficam neste computador.</p>
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
    oncustomer={(c) => (customer = c)}
    ondone={finished}
    onclose={() => (modal = '')}
  />
{:else if modal === 'done' && done}
  <Modal title={`Venda #${done.sale.code} concluída`} onclose={() => (modal = '')} width="460px">
    <div class="done">
      <div class="row"><span class="muted">Total</span><span class="spacer"></span><strong>{fmt(done.sale.total)}</strong></div>
      {#if done.sale.credit_used}
        <div class="row"><span class="muted">Vale-troca</span><span class="spacer"></span><span class="green">− {fmt(done.sale.credit_used)}</span></div>
      {/if}
      <div class="row"><span class="muted">Pagamento</span><span class="spacer"></span><span>{done.sale.payment_label ?? PAYMENT_LABELS[done.sale.payment_type]}</span></div>
      {#if done.cashTendered && done.cashTendered > cashDueOf(done.sale)}
        <div class="money-box center"><span>Troco</span><strong>{fmt(round2(done.cashTendered - cashDueOf(done.sale)))}</strong></div>
      {/if}
      {#if done.sale.payment_type === 'crediario' && done.sale.installments?.length}
        <div class="muted small">
          {done.sale.installments.length} parcela(s), última em {fmtDate(done.sale.installments[done.sale.installments.length - 1].due_date)}
        </div>
      {/if}
      {#if done.print}
        <div class="alert" class:ok={done.print.ok}>{done.print.ok ? 'Cupom impresso.' : `Não imprimiu: ${done.print.message}`}</div>
      {/if}
      {#if done.carne}
        <div class="alert" class:ok={done.carne.ok}>{done.carne.ok ? done.carne.message : `Carnê não imprimiu: ${done.carne.message}`}</div>
      {/if}
    </div>
    {#snippet footer()}
      {#if done?.sale.payment_type === 'crediario' && canPrintCarne(session.settings)}
        <button onclick={carne} disabled={printingCarne}>{printingCarne ? 'Enviando…' : 'Imprimir carnê'}</button>
      {/if}
      <button onclick={reprint} disabled={!canPrintReceipt(session.settings)}>Imprimir <kbd>P</kbd></button>
      <button class="primary" onclick={() => (modal = '')}>Nova venda <kbd>Enter</kbd></button>
    {/snippet}
  </Modal>
{/if}

<style>
  .screen {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  .catalog {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 24px;
  }
  .search {
    position: relative;
    display: block;
  }
  .search input {
    height: 60px;
    border-radius: 16px;
    border: 2px solid var(--line);
    padding: 0 120px 0 52px;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .search input:focus {
    border-color: var(--brand);
  }
  .lens {
    position: absolute;
    left: 16px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--faint);
    display: flex;
  }
  .hint {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    background: #f8fafc;
  }
  .flash {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 999px;
    background: #d1fae5;
    color: var(--ok);
  }
  .flash.error {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .toolbar {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .chips {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .view {
    margin-left: auto;
    flex: none;
    display: flex;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: #fff;
  }
  .view button {
    height: 28px;
    width: 34px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    justify-content: center;
    color: var(--muted);
  }
  .view button.on,
  .view button.on:hover {
    background: var(--brand);
    color: #fff;
  }
  .chips button {
    height: 34px;
    padding: 0 14px;
    border-radius: 999px;
    font-size: 13px;
    color: #475569;
  }
  .chips button.on {
    background: var(--brand);
    border-color: var(--brand);
    color: #fff;
  }
  .grid-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 12px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 58px;
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: #fff;
    cursor: pointer;
  }
  .prow:hover {
    border-color: var(--brand-200);
  }
  .prow.incart {
    border-color: var(--brand);
    box-shadow: inset 0 0 0 1px var(--brand);
  }
  .prow.hl {
    border-color: var(--brand);
    box-shadow: 0 0 0 4px rgb(37 99 235 / 20%);
  }
  .prow .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .prow .name {
    min-height: 0;
    padding-right: 0;
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .prow .variants-inline {
    margin-top: 0;
    max-width: 50%;
    justify-content: flex-end;
  }
  .prow .stock {
    flex: none;
    width: 74px;
    text-align: right;
  }
  .prow .price {
    flex: none;
    width: 100px;
    text-align: right;
  }
  .prow .qty {
    position: static;
    flex: none;
  }
  .prow .qty.none {
    visibility: hidden;
  }
  .empty {
    padding: 40px 0;
    text-align: center;
  }
  .product {
    position: relative;
    height: auto;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 0;
    padding: 14px;
    border-radius: 18px;
    text-align: left;
    box-shadow: 0 1px 2px rgb(15 23 42 / 5%);
  }
  .product.grade {
    display: flex;
    border: 1px solid var(--line);
    background: #fff;
    cursor: pointer;
  }
  .variants-inline .more {
    color: var(--brand);
  }
  .product:hover:not(:disabled) {
    border-color: var(--brand-200);
    background: #fff;
  }
  .product.incart {
    border: 2px solid var(--brand);
  }
  .product.hl {
    box-shadow: 0 0 0 4px rgb(37 99 235 / 20%);
    border-color: var(--brand);
  }
  .qty {
    position: absolute;
    top: 10px;
    right: 10px;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--brand);
    color: #fff;
    font-size: 12px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sku {
    margin-top: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .variants-inline {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .variants-inline button {
    height: 30px;
    min-width: 40px;
    padding: 0 8px;
    gap: 4px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
  }
  /* "38: 2" (estoque) ou "38 ×2" (no carrinho), e não "38 2". */
  .variants-inline button small {
    font-size: 11px;
    font-weight: 700;
  }
  .variants-inline button.out {
    border-style: dashed;
    color: var(--muted);
  }
  .variants-inline button.out small {
    color: var(--danger);
  }
  .name {
    padding-right: 28px;
    min-height: 40px;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    color: var(--ink);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .bottom {
    margin-top: 8px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 8px;
  }
  .price {
    font-size: 16px;
    font-weight: 800;
    color: var(--ink);
  }
  .stock {
    font-size: 11px;
    font-weight: 600;
    color: var(--faint);
  }
  .stock.low {
    color: var(--warn);
  }
  .stock.zero {
    color: var(--danger);
  }
  .side {
    width: 420px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-left: 1px solid var(--line);
    min-height: 0;
  }
  .customer {
    padding: 16px;
    border-bottom: 1px solid var(--line-soft);
    display: grid;
    gap: 10px;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .who strong {
    font-size: 14px;
  }
  .who span {
    font-size: 12px;
    color: var(--muted);
  }
  .x {
    width: 32px;
    height: 32px;
    padding: 0;
    color: var(--faint);
  }
  .pick {
    justify-content: flex-start;
    height: 48px;
    border-style: dashed;
    color: var(--ink-2);
  }
  .pick > span {
    flex: 1;
    text-align: left;
  }
  .cart {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-soft);
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .info strong {
    font-size: 14px;
    font-weight: 600;
  }
  .info span {
    font-size: 12px;
    color: var(--muted);
  }
  .info .variant {
    color: var(--brand);
    font-weight: 700;
  }
  .held-on {
    border-color: var(--warn);
    color: var(--warn);
    background: var(--warn-bg);
  }
  .lookup {
    height: 30px;
    justify-content: center;
    font-size: 13px;
  }
  .held {
    display: grid;
    gap: 8px;
  }
  .held-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .held-pick {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 10px 14px;
    justify-content: space-between;
    text-align: left;
  }
  .held-who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .held-who small {
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .held-row .ghost {
    height: auto;
    padding: 0 10px;
  }
  .variants {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .variants button {
    position: relative;
    height: auto;
    min-height: 60px;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    padding: 8px 12px;
    text-align: left;
  }
  .variants button strong {
    font-size: 14px;
    font-weight: 700;
  }
  .variants button small {
    font-size: 12px;
    color: var(--muted);
  }
  .variants button.out {
    border-style: dashed;
    opacity: 0.75;
  }
  /* Destacada pelas setas: Enter põe no carrinho. */
  .variants button:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 4px rgb(37 99 235 / 20%);
    opacity: 1;
  }
  .variants button.out small {
    color: var(--danger);
  }
  .variants kbd {
    position: absolute;
    top: 6px;
    right: 6px;
  }
  .stepper {
    display: flex;
    align-items: center;
    border-radius: 12px;
    background: var(--soft);
    padding: 2px;
  }
  .stepper button {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: #475569;
  }
  .stepper button:hover:not(:disabled) {
    background: #fff;
  }
  .stepper span {
    min-width: 28px;
    text-align: center;
    font-size: 14px;
    font-weight: 800;
  }
  .total {
    width: 86px;
    font-size: 14px;
    font-weight: 800;
  }
  .free {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 6px;
    text-align: center;
    color: var(--faint);
    padding: 24px;
  }
  .free strong {
    color: var(--ink);
    font-size: 16px;
  }
  .totals {
    padding: 16px;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 8px;
  }
  .sub {
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .sub .num {
    color: var(--ink);
  }
  .sub .num.green {
    color: var(--ok);
  }
  .link {
    height: auto;
    padding: 0;
    gap: 6px;
    color: var(--muted);
    font-size: 13px;
  }
  .grand {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px 0 6px;
  }
  .grand span {
    font-size: 14px;
    font-weight: 700;
    color: #475569;
  }
  .grand strong {
    font-size: 40px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .grid2 button {
    font-size: 13px;
  }
  .form,
  .done {
    display: grid;
    gap: 12px;
  }
  .center {
    text-align: center;
  }
</style>
