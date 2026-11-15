<script lang="ts">
  import type { Customer, Sale } from '../api'
  import { Attempt } from '../attempt'
  import { fmt } from '../money'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import Modal from './Modal.svelte'

  let {
    onpick,
    onclose,
    onsale,
  }: {
    onpick: (c: Customer) => void
    onclose: () => void
    /** No Receber: permite buscar pelo número da venda (o do carnê). */
    onsale?: (s: Sale) => void
  } = $props()

  let mode = $state<'cliente' | 'venda'>('cliente')
  let sale = $state<Sale | null>(null)
  let searchEl: HTMLInputElement | undefined = $state()
  let search = $state('')
  let results = $state<Customer[]>([])
  let active = $state(0)
  let loading = $state(false)
  let error = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  // Cadastro rápido
  let creating = $state(false)
  let form = $state({ name: '', cpf: '', phone: '' })
  let saving = $state(false)
  const attempt = new Attempt()

  function onInput() {
    clearTimeout(timer)
    timer = setTimeout(load, 250)
  }

  function setMode(m: 'cliente' | 'venda') {
    mode = m
    search = ''
    results = []
    sale = null
    error = ''
    searchEl?.focus()
  }

  /** "1165", "#1165" ou o documento do carnê "1165/002-005" → 1165. */
  const saleCodeOf = (term: string) => term.match(/^#?\s*0*(\d{1,9})(\s*\/.*)?$/)?.[1] ?? null

  async function loadSale() {
    const code = saleCodeOf(search.trim())
    sale = null
    if (!code) return
    const mine = ++seq
    loading = true
    error = ''
    try {
      const res = await session.api.sales({ search: code, payment_type: 'crediario' })
      if (mine === seq) sale = res.data.find((s) => s.customer && s.status !== 'cancelled') ?? null
    } catch (e) {
      if (mine === seq) error = (e as Error).message
    } finally {
      if (mine === seq) loading = false
    }
  }

  async function load() {
    if (mode === 'venda') return loadSale()
    const term = search.trim()
    if (term.length < 2) {
      results = []
      return
    }
    const mine = ++seq
    loading = true
    error = ''
    try {
      const res = await session.api.customers(term)
      if (mine === seq) {
        results = res.data
        active = 0
      }
    } catch (e) {
      if (mine === seq) error = (e as Error).message
    } finally {
      if (mine === seq) loading = false
    }
  }

  function keydown(e: KeyboardEvent) {
    if (mode === 'venda') {
      if (e.key === 'Enter' && sale && onsale) {
        e.preventDefault()
        onsale(sale)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      active = Math.min(active + 1, results.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(active - 1, 0)
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      onpick(results[active])
    }
  }

  /** Abre o cadastro já com o que foi digitado (nome, ou CPF/telefone se for número). */
  function startCreate() {
    const term = search.trim()
    const digits = term.replace(/\D/g, '')
    form = {
      name: digits.length >= 8 && digits.length === term.replace(/[.\-()\s]/g, '').length ? '' : term,
      cpf: digits.length === 11 && !/^\(?\d{2}\)?\s?9/.test(term) ? digits : '',
      phone: digits.length >= 10 && digits.length <= 11 && /^\(?\d{2}\)?\s?9/.test(term) ? digits : '',
    }
    error = ''
    creating = true
  }

  async function save(e: SubmitEvent) {
    e.preventDefault()
    if (saving || !form.name.trim()) return
    saving = true
    error = ''
    try {
      const body = {
        name: form.name.trim(),
        cpf: form.cpf.replace(/\D/g, '') || null,
        phone: form.phone.replace(/\D/g, '') || null,
      }
      const c = await session.api.createCustomer(body, attempt.keyFor(body))
      onpick(c)
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }
</script>

{#snippet createFooter()}
  <button onclick={() => (creating = false)}>Voltar</button>
  <button class="primary" type="submit" form="new-customer" disabled={saving || !form.name.trim()}>
    {saving ? 'Salvando…' : 'Cadastrar e usar'}
  </button>
{/snippet}

<Modal title={creating ? 'Novo cliente' : 'Cliente'} {onclose} width="640px" footer={creating ? createFooter : undefined}>
  {#if creating}
    <form id="new-customer" class="form" onsubmit={save}>
      <!-- svelte-ignore a11y_autofocus -->
      <label>Nome completo <input bind:value={form.name} maxlength="255" required autofocus /></label>
      <div class="grid2">
        <label>CPF <span class="opt">(obrigatório só no crediário da loja, se ela exigir)</span><input bind:value={form.cpf} inputmode="numeric" placeholder="000.000.000-00" /></label>
        <label>Telefone / WhatsApp <input bind:value={form.phone} inputmode="tel" placeholder="(00) 00000-0000" /></label>
      </div>
      <p class="muted small">Endereço e outros dados podem ser completados depois no Credix web.</p>
      {#if error}<div class="alert">{error}</div>{/if}
    </form>
  {:else}
    {#if onsale}
      <div class="modes">
        <button class:selected={mode === 'cliente'} onclick={() => setMode('cliente')}>Cliente</button>
        <button class:selected={mode === 'venda'} onclick={() => setMode('venda')}>Nº da venda</button>
      </div>
    {/if}
    <div class="row">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        bind:this={searchEl}
        placeholder={mode === 'venda' ? 'Número da venda, como está no carnê' : 'Nome, CPF, telefone ou código do cliente'}
        bind:value={search}
        oninput={onInput}
        onkeydown={keydown}
      />
      {#if mode === 'cliente'}<button class="newbtn" onclick={startCreate}><Icon name="plus" size={16} /> Novo</button>{/if}
    </div>
    {#if error}<div class="alert">{error}</div>{/if}
    {#if mode === 'venda'}
      <div class="list">
        {#if sale && sale.customer}
          <button class="item active" onclick={() => sale && onsale?.(sale)}>
            <span class="avatar"><Icon name="cart" size={18} /></span>
            <span class="who">
              <strong>Venda #{sale.code} · {sale.customer.name}</strong>
              <span>
                {sale.created_at_formatted}{#if sale.remaining_amount !== undefined} · {sale.remaining_amount > 0
                    ? `em aberto ${fmt(sale.remaining_amount)}`
                    : 'sem parcelas em aberto'}{/if}
              </span>
            </span>
            <kbd>Enter</kbd>
          </button>
        {:else}
          <div class="none muted">
            {#if loading}
              Buscando…
            {:else if !saleCodeOf(search.trim())}
              Digite o número da venda que está no carnê.
            {:else}
              Nenhuma venda no crediário com esse número.
            {/if}
          </div>
        {/if}
      </div>
    {:else}
    <div class="list">
      {#each results as c, i (c.id)}
        <button class="item" class:active={i === active} onclick={() => onpick(c)} onmouseenter={() => (active = i)}>
          <span class="avatar">{c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
          <span class="who">
            <strong>{c.name}</strong>
            <span>
              {#if c.code}#{c.code} · {/if}{c.cpf_formatted ?? 'sem CPF'}{#if c.phone_formatted} · {c.phone_formatted}{/if}
            </span>
          </span>
          {#if c.overdue_count}
            <span class="badge late">{c.overdue_count} em atraso</span>
          {/if}
        </button>
      {:else}
        <div class="none muted">
          {#if loading}
            Buscando…
          {:else if search.trim().length < 2}
            Digite ao menos 2 letras.
          {:else}
            Nenhum cliente encontrado.
            <button class="ghost link" onclick={startCreate}>Cadastrar “{search.trim()}”</button>
          {/if}
        </div>
      {/each}
    </div>
    {/if}
  {/if}

</Modal>

<style>
  .modes {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--soft);
    justify-self: start;
  }
  .modes button {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    font-size: 13px;
  }
  .modes button.selected {
    background: #fff;
    border: 0;
    color: var(--ink);
    box-shadow: 0 1px 2px rgb(15 23 42 / 10%);
  }
  .form {
    display: grid;
    gap: 14px;
  }
  .opt {
    font-weight: 500;
    color: var(--faint);
  }
  .newbtn {
    flex: none;
  }
  .list {
    display: grid;
    gap: 4px;
    max-height: 50vh;
    overflow: auto;
  }
  .item {
    height: auto;
    padding: 10px 12px;
    justify-content: flex-start;
    gap: 12px;
    text-align: left;
    border-color: transparent;
  }
  .item.active {
    background: var(--brand-50);
    border-color: var(--brand-200);
  }
  .who {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  .who strong {
    color: var(--ink);
  }
  .who span {
    font-size: 12px;
    color: var(--muted);
  }
  .none {
    padding: 16px 4px;
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 14px;
  }
  .link {
    height: auto;
    padding: 0;
    color: var(--brand);
  }
</style>
