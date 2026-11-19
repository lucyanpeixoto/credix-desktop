<script lang="ts">
  import type { Customer, CustomerAddress, NewCustomer, Sale } from '../api'
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

  // Cadastro (mesmos campos do Credix web)
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
  const emptyForm = () => ({
    name: '',
    cpf: '',
    phone: '',
    email: '',
    information: '',
    address: { zipcode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' },
  })
  let creating = $state(false)
  let form = $state(emptyForm())
  let saving = $state(false)
  let numberEl: HTMLInputElement | undefined = $state()
  let zipStatus = $state<'' | 'loading' | 'notfound' | 'offline'>('')
  let zipLooked = ''
  const attempt = new Attempt()

  const digitsOf = (v: string) => v.replace(/\D/g, '')
  const fmtCpf = (v: string) => {
    const d = digitsOf(v)
    return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v
  }
  const fmtPhone = (v: string) => {
    const d = digitsOf(v)
    if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
    if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
    return v
  }
  const fmtZip = (v: string) => {
    const d = digitsOf(v)
    return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : v
  }

  /** Com os 8 dígitos do CEP, busca no ViaCEP (como o web) e preenche rua, bairro, cidade e UF. */
  async function lookupZip() {
    const d = digitsOf(form.address.zipcode)
    if (d.length !== 8) {
      zipStatus = ''
      zipLooked = ''
      return
    }
    if (d === zipLooked) return
    zipLooked = d
    form.address.zipcode = fmtZip(d)
    zipStatus = 'loading'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: ctrl.signal })
      const data = await res.json()
      if (digitsOf(form.address.zipcode) !== d) return
      if (!res.ok || data?.erro) {
        zipStatus = 'notfound'
        return
      }
      const a = form.address
      a.street = data.logradouro || a.street
      a.neighborhood = data.bairro || a.neighborhood
      a.city = data.localidade || a.city
      a.state = UFS.includes(data.uf) ? data.uf : a.state
      zipStatus = ''
      numberEl?.focus()
    } catch {
      zipLooked = ''
      zipStatus = 'offline'
    } finally {
      clearTimeout(timer)
    }
  }

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
      ...emptyForm(),
      name: digits.length >= 8 && digits.length === term.replace(/[.\-()\s]/g, '').length ? '' : term,
      cpf: digits.length === 11 && !/^\(?\d{2}\)?\s?9/.test(term) ? digits : '',
      phone: digits.length >= 10 && digits.length <= 11 && /^\(?\d{2}\)?\s?9/.test(term) ? digits : '',
    }
    form.cpf = fmtCpf(form.cpf)
    form.phone = fmtPhone(form.phone)
    zipStatus = ''
    zipLooked = ''
    error = ''
    creating = true
  }

  async function save(e: SubmitEvent) {
    e.preventDefault()
    if (saving || !form.name.trim()) return
    saving = true
    error = ''
    try {
      const text = (v: string) => v.trim() || null
      const a = form.address
      const address: CustomerAddress = {
        zipcode: digitsOf(a.zipcode) || null,
        street: text(a.street),
        number: text(a.number),
        complement: text(a.complement),
        neighborhood: text(a.neighborhood),
        city: text(a.city),
        state: a.state || null,
      }
      const body: NewCustomer = {
        name: form.name.trim(),
        cpf: digitsOf(form.cpf) || null,
        phone: digitsOf(form.phone) || null,
        email: text(form.email),
        information: text(form.information),
        // O Credix só grava o endereço com CEP ou rua.
        address: address.zipcode || address.street ? address : null,
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
        <label>CPF <span class="opt">(obrigatório só no crediário da loja, se ela exigir)</span>
          <input bind:value={form.cpf} onblur={() => (form.cpf = fmtCpf(form.cpf))} inputmode="numeric" maxlength="14" placeholder="000.000.000-00" />
        </label>
        <label>Telefone / WhatsApp
          <input bind:value={form.phone} onblur={() => (form.phone = fmtPhone(form.phone))} inputmode="tel" maxlength="20" placeholder="(00) 00000-0000" />
        </label>
      </div>
      <label>E-mail <input type="email" bind:value={form.email} maxlength="255" placeholder="opcional" /></label>
      <label>Observações <textarea bind:value={form.information} rows="2" placeholder="opcional"></textarea></label>

      <fieldset class="address">
        <legend>Endereço <span class="opt">(opcional)</span></legend>
        <div class="cols">
          <label class="c2">CEP
            <input bind:value={form.address.zipcode} oninput={lookupZip} onblur={lookupZip} inputmode="numeric" maxlength="9" placeholder="00000-000" />
            {#if zipStatus === 'loading'}<span class="hint">Buscando o CEP…</span>
            {:else if zipStatus === 'notfound'}<span class="hint bad">CEP não encontrado.</span>
            {:else if zipStatus === 'offline'}<span class="hint warn">Não deu para buscar o CEP agora. Preencha à mão.</span>{/if}
          </label>
          <label class="c4">Rua <input bind:value={form.address.street} maxlength="255" /></label>
          <label class="c2">Número <input bind:this={numberEl} bind:value={form.address.number} maxlength="50" /></label>
          <label class="c4">Complemento <input bind:value={form.address.complement} maxlength="255" /></label>
          <label class="c3">Bairro <input bind:value={form.address.neighborhood} maxlength="255" /></label>
          <label class="c2">Cidade <input bind:value={form.address.city} maxlength="255" /></label>
          <label class="c1">UF
            <select bind:value={form.address.state}>
              <option value="">—</option>
              {#each UFS as uf (uf)}<option value={uf}>{uf}</option>{/each}
            </select>
          </label>
        </div>
      </fieldset>
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
  textarea {
    height: auto;
    padding: 10px 14px;
    resize: vertical;
  }
  .address {
    margin: 0;
    padding: 14px;
    border: 1px solid var(--line-soft);
    border-radius: 14px;
    min-width: 0;
  }
  legend {
    padding: 0 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
  }
  .c1 {
    grid-column: span 1;
  }
  .c2 {
    grid-column: span 2;
  }
  .c3 {
    grid-column: span 3;
  }
  .c4 {
    grid-column: span 4;
  }
  .hint {
    font-weight: 500;
    color: var(--muted);
  }
  .hint.bad {
    color: var(--danger);
  }
  .hint.warn {
    color: #b45309;
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
