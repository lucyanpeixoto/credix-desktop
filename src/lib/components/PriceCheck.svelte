<script lang="ts">
  // Consulta rápida (F10): lê a etiqueta ou digita o nome e vê preço e o
  // estoque de cada tamanho/cor, sem mexer no carrinho. "Tem no M?"
  import { tick } from 'svelte'
  import { ApiError, type Product, type ProductVariant } from '../api'
  import { fmt } from '../money'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import Modal from './Modal.svelte'

  let {
    onclose,
    onadd,
    lowLimit,
  }: {
    onclose: () => void
    /** Pôr no carrinho direto da consulta (opcional, um clique). */
    onadd: (p: Product, v: ProductVariant | null) => void
    lowLimit: number
  } = $props()

  let inputEl = $state<HTMLInputElement>()
  let term = $state('')
  let product = $state<Product | null>(null)
  let matchedId = $state<string | null>(null)
  let results = $state<Product[]>([])
  let error = $state('')
  let loading = $state(false)
  let seq = 0

  const grade = $derived(product?.has_variants && product.variants?.length ? product.variants : [])
  const gradeStock = $derived(grade.reduce((s, v) => s + Math.max(0, v.stock), 0))

  async function lookup(e?: SubmitEvent) {
    e?.preventDefault()
    const code = term.trim()
    if (!code) return
    const mine = ++seq
    loading = true
    error = ''
    try {
      // Primeiro o código exato (leitor), depois a busca por nome.
      try {
        const res = await session.api.productBySku(code)
        if (mine !== seq) return
        show(res.data, res.matched_variant_id ?? null)
        return
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err
      }
      const res = await session.api.products(code, 8)
      if (mine !== seq) return
      if (res.data.length === 1) return show(res.data[0], null)
      product = null
      results = res.data
      if (!res.data.length) error = `Nenhum produto com “${code}”.`
    } catch (err) {
      if (mine === seq) error = (err as Error).message
    } finally {
      if (mine === seq) loading = false
    }
  }

  function show(p: Product, variantId: string | null) {
    product = p
    matchedId = variantId
    results = []
    term = ''
    tick().then(() => inputEl?.focus())
  }

  const stockClass = (n: number) => (n <= 0 ? 'zero' : n <= lowLimit ? 'low' : '')
</script>

<Modal title="Consultar preço e estoque" {onclose} width="560px">
  <form class="find" onsubmit={lookup}>
    <span class="lens"><Icon name="search" size={18} /></span>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:this={inputEl} bind:value={term} autofocus autocomplete="off" spellcheck="false" placeholder="Passe a etiqueta ou digite o nome e Enter" />
  </form>

  {#if error}<div class="alert">{error}</div>{/if}
  {#if loading}<p class="muted">Consultando…</p>{/if}

  {#if results.length}
    <div class="results">
      {#each results as r (r.id)}
        <button onclick={() => show(r, null)}>
          <span class="rname">{r.name}{#if r.sku}<small> · SKU {r.sku}</small>{/if}</span>
          <strong>{fmt(r.price)}</strong>
        </button>
      {/each}
    </div>
  {/if}

  {#if product}
    <div class="card">
      <div class="head">
        <div>
          <strong class="pname">{product.name}</strong>
          <span class="muted">{product.sku ? `SKU ${product.sku}` : 'sem SKU'}{product.active ? '' : ' · inativo'}</span>
        </div>
        <strong class="price">{fmt(product.price)}</strong>
      </div>

      {#if grade.length}
        <p class="muted small">Estoque por tamanho/cor · total {gradeStock}. Clique para pôr no carrinho.</p>
        <div class="grade">
          {#each grade as v (v.id)}
            <button class:matched={v.id === matchedId} class={stockClass(v.stock)} onclick={() => onadd(product!, v)} title={v.code ?? ''}>
              <span>{v.label}</span>
              <strong>{Math.max(0, v.stock)}</strong>
            </button>
          {/each}
        </div>
      {:else}
        <div class="single">
          <span class="muted">Em estoque</span>
          <strong class={stockClass(product.stock ?? 0)}>{product.stock ?? '—'}</strong>
          <button class="primary" onclick={() => onadd(product!, null)}>Pôr no carrinho</button>
        </div>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .find {
    position: relative;
  }
  .find input {
    height: 50px;
    padding-left: 42px;
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
  .results {
    display: grid;
    gap: 6px;
  }
  .results button {
    justify-content: space-between;
    height: auto;
    min-height: 44px;
    padding: 8px 12px;
    text-align: left;
  }
  .rname {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rname small {
    color: var(--muted);
    font-weight: 500;
  }
  .card {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 16px;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .head > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .pname {
    font-size: 17px;
  }
  .price {
    font-size: 24px;
    font-weight: 800;
    white-space: nowrap;
  }
  .small {
    font-size: 12px;
  }
  .grade {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 8px;
  }
  .grade button {
    height: auto;
    min-height: 54px;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
  }
  .grade button span {
    font-size: 13px;
  }
  .grade button strong {
    font-size: 18px;
  }
  .grade button.matched {
    border: 2px solid var(--brand);
  }
  .grade button.zero {
    border-style: dashed;
    color: var(--muted);
  }
  .grade button.zero strong,
  .single strong.zero {
    color: var(--danger);
  }
  .grade button.low strong,
  .single strong.low {
    color: var(--warn);
  }
  .single {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .single strong {
    font-size: 24px;
    margin-right: auto;
  }
</style>
