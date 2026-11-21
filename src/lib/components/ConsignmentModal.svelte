<script lang="ts">
  import { onMount } from 'svelte'
  import type { Consignment, ConsignmentItem, Customer } from '../api'
  import { Attempt } from '../attempt'
  import type { CartItem } from '../cart'
  import { fmt, fmtDate, todayIso } from '../money'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import CustomerPicker from './CustomerPicker.svelte'
  import Modal from './Modal.svelte'

  let {
    items,
    customer,
    oncustomer,
    oncreated,
    oncharge,
    onchanged,
    onclose,
  }: {
    /** Carrinho aberto: são as peças que o cliente vai levar. */
    items: CartItem[]
    customer: Customer | null
    oncustomer: (c: Customer) => void
    oncreated: (c: Consignment) => void
    /** O cliente voltou e ficou com estas peças: vão para o carrinho para cobrar. */
    oncharge: (c: Consignment, kept: { item: ConsignmentItem; quantity: number }[]) => void
    /** Um condicional foi encerrado (devolveu tudo). */
    onchanged: () => void
    onclose: () => void
  } = $props()

  const DEFAULT_DAYS = 3
  function inDays(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() + n)
    const p = (v: number) => String(v).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  // svelte-ignore state_referenced_locally
  let tab = $state<'new' | 'open'>(items.length ? 'new' : 'open')
  let list = $state<Consignment[]>([])
  let loading = $state(true)
  let error = $state('')
  let saving = $state(false)
  let picking = $state(false)
  /** consignment: o cliente leva para casa; reservation: fica guardada na loja. */
  let kind = $state<'consignment' | 'reservation'>('consignment')
  let due = $state(inDays(DEFAULT_DAYS))
  let notes = $state('')
  /** Condicional aberto para acerto e quantas peças de cada item ficaram. */
  let settling = $state<Consignment | null>(null)
  let kept = $state<Record<number, number>>({})
  const attempt = new Attempt()

  const loose = $derived(items.filter((i) => !i.product_id))
  const pieces = $derived(items.reduce((s, i) => s + i.quantity, 0))
  const value = $derived(items.reduce((s, i) => s + i.unit_price * i.quantity, 0))
  const keptPieces = $derived(settling ? settling.items.reduce((s, i) => s + (kept[i.id] ?? 0), 0) : 0)
  const keptValue = $derived(settling ? settling.items.reduce((s, i) => s + (kept[i.id] ?? 0) * i.unit_price, 0) : 0)
  const problem = $derived.by(() => {
    if (!items.length) return 'Passe no caixa as peças do cliente.'
    if (loose.length) return 'Item avulso não entra em reserva nem em condicional: tire-o da venda.'
    if (!customer) return kind === 'reservation' ? 'Escolha o cliente da reserva.' : 'Escolha o cliente que vai levar as peças.'
    if (!due || due < todayIso()) return 'A data não pode ser no passado.'
    return ''
  })

  async function load() {
    loading = true
    try {
      list = (await session.api.consignments()).data
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }
  onMount(load)

  async function create() {
    if (saving || problem || !customer) return
    saving = true
    error = ''
    const body = {
      customer_id: customer.id,
      kind,
      due_date: due,
      notes: notes.trim() || null,
      items: items.map((i) => ({ product_id: i.product_id, product_variant_id: i.variant_id ?? null, quantity: i.quantity })),
    }
    try {
      oncreated(await session.api.createConsignment(body, attempt.keyFor(body)))
    } catch (e) {
      error = (e as Error).message
      saving = false
    }
  }

  function settle(c: Consignment) {
    settling = c
    // Começa com tudo "ficou" (ou "vai levar"): a vendedora tira o resto.
    kept = Object.fromEntries(c.items.map((i) => [i.id, i.quantity]))
    error = ''
  }

  function step(i: ConsignmentItem, delta: number) {
    kept[i.id] = Math.max(0, Math.min(i.quantity, (kept[i.id] ?? 0) + delta))
  }

  async function returnAll() {
    if (!settling || saving) return
    saving = true
    error = ''
    try {
      await session.api.returnConsignment(settling.id, attempt.keyFor(['return', settling.id]))
      attempt.reset()
      list = list.filter((c) => c.id !== settling?.id)
      settling = null
      onchanged()
    } catch (e) {
      error = (e as Error).message
    } finally {
      saving = false
    }
  }

  function charge() {
    if (!settling) return
    const c = settling
    oncharge(
      c,
      c.items.filter((i) => (kept[i.id] ?? 0) > 0).map((i) => ({ item: i, quantity: kept[i.id] })),
    )
  }
</script>

{#snippet footer()}
  {#if settling}
    <button onclick={() => (settling = null)}>Voltar</button>
    <span class="spacer"></span>
    {#if keptPieces === 0}
      <button class="primary" disabled={saving} onclick={returnAll}
        >{saving ? 'Salvando…' : settling.kind === 'reservation' ? 'Desistiu: cancelar a reserva' : 'Devolveu tudo: encerrar'}</button
      >
    {:else}
      <button class="primary" onclick={charge}>Cobrar {keptPieces} {keptPieces === 1 ? 'peça' : 'peças'} · {fmt(keptValue)}</button>
    {/if}
  {:else if tab === 'new'}
    <button onclick={onclose}>Voltar</button>
    <span class="spacer"></span>
    <button class="primary" disabled={saving || !!problem} onclick={create}
      >{saving ? 'Salvando…' : kind === 'reservation' ? 'Reservar as peças' : 'Entregar as peças'}</button
    >
  {:else}
    <button onclick={onclose}>Fechar</button>
  {/if}
{/snippet}

<Modal
  title={settling ? `${settling.kind === 'reservation' ? 'Reserva' : 'Condicional'} #${settling.code} · ${settling.customer?.name ?? ''}` : 'Reserva e condicional'}
  {onclose}
  width="620px"
  {footer}
>
  {#if settling}
    {@const res = settling.kind === 'reservation'}
    <p class="muted">
      {#if res}
        Reservado em {fmtDate(settling.created_at)}{settling.seller ? ` por ${settling.seller}` : ''} · guardar até {fmtDate(settling.due_date)}.
        Marque quantas peças <strong>o cliente vai levar</strong>; o resto volta ao estoque.
      {:else}
        Saiu em {fmtDate(settling.created_at)}{settling.seller ? ` com ${settling.seller}` : ''} · devolver até {fmtDate(settling.due_date)}.
        Marque quantas peças <strong>ficaram com o cliente</strong>; o resto volta ao estoque.
      {/if}
    </p>
    <div class="rows">
      {#each settling.items as i (i.id)}
        <div class="line" class:back={(kept[i.id] ?? 0) === 0}>
          <span class="what">
            <strong>{i.name}</strong>
            <small>{i.variant_label ? `${i.variant_label} · ` : ''}{fmt(i.unit_price)} un. · {res ? 'reservou' : 'levou'} {i.quantity}</small>
          </span>
          <span class="state"
            >{(kept[i.id] ?? 0) === 0
              ? res
                ? 'desistiu'
                : 'devolveu'
              : (kept[i.id] ?? 0) === i.quantity
                ? res
                  ? 'vai levar'
                  : 'ficou'
                : `${res ? 'leva' : 'ficou'} ${kept[i.id]} de ${i.quantity}`}</span
          >
          <div class="stepper">
            <button onclick={() => step(i, -1)} disabled={(kept[i.id] ?? 0) <= 0} aria-label="Uma a menos"><Icon name="minus" size={16} /></button>
            <span>{kept[i.id] ?? 0}</span>
            <button onclick={() => step(i, 1)} disabled={(kept[i.id] ?? 0) >= i.quantity} aria-label="Uma a mais"><Icon name="plus" size={16} /></button>
          </div>
        </div>
      {/each}
    </div>
    <div class="row">
      <button class="ghost link" onclick={() => settling && (kept = Object.fromEntries(settling.items.map((i) => [i.id, 0])))}>{res ? 'Desistiu de tudo' : 'Devolveu tudo'}</button>
      <button class="ghost link" onclick={() => settling && (kept = Object.fromEntries(settling.items.map((i) => [i.id, i.quantity])))}>{res ? 'Vai levar tudo' : 'Ficou com tudo'}</button>
    </div>
    {#if keptPieces > 0}
      <p class="muted">
        {res
          ? 'As peças que ele vai levar vão para a venda; a reserva encerra quando a venda for finalizada.'
          : 'As peças que ficaram vão para a venda; o condicional encerra quando a venda for finalizada.'}
      </p>
    {/if}
  {:else}
    <div class="tabs">
      <button class:on={tab === 'new'} onclick={() => (tab = 'new')}>Nova</button>
      <button class:on={tab === 'open'} onclick={() => (tab = 'open')}>Em aberto{list.length ? ` (${list.length})` : ''}</button>
    </div>

    {#if tab === 'new'}
      {#if !items.length}
        <p class="muted empty">Passe no caixa as peças do cliente e abra esta janela de novo.</p>
      {:else}
        <div class="kinds">
          <button class:on={kind === 'consignment'} onclick={() => (kind = 'consignment')}>
            <strong>Levar para casa</strong>
            <small>Condicional: o cliente prova em casa</small>
          </button>
          <button class:on={kind === 'reservation'} onclick={() => (kind = 'reservation')}>
            <strong>Reservar na loja</strong>
            <small>A peça fica guardada para ele</small>
          </button>
        </div>
        <div class="rows">
          {#each items as i (i.key)}
            <div class="line" class:bad={!i.product_id}>
              <span class="what">
                <strong>{i.quantity}× {i.name}</strong>
                <small>{i.variant_label ? `${i.variant_label} · ` : ''}{i.product_id ? `${fmt(i.unit_price)} un.` : 'item avulso'}</small>
              </span>
              <span class="num">{fmt(i.unit_price * i.quantity)}</span>
            </div>
          {/each}
        </div>
        <p class="sum">{pieces} {pieces === 1 ? 'peça' : 'peças'} · {fmt(value)}</p>

        <div class="fields">
          <div class="who">
            <span class="lbl">Cliente</span>
            <button class="pick" onclick={() => (picking = true)}>
              <Icon name="user" size={16} />
              {#if customer}
                <strong>{customer.name}</strong>
                {#if customer.phone_formatted}<small>{customer.phone_formatted}</small>{/if}
                <span class="muted">trocar</span>
              {:else}
                <span>Escolher ou cadastrar o cliente</span>
              {/if}
            </button>
          </div>
          <label>{kind === 'reservation' ? 'Guardar até' : 'Devolver até'} <input type="date" bind:value={due} min={todayIso()} /></label>
        </div>
        <label>Observação <input bind:value={notes} maxlength="500" placeholder="Opcional" /></label>
        <p class="muted">
          {kind === 'reservation'
            ? 'As peças saem do estoque agora e ficam separadas na loja. Nada é cobrado ainda.'
            : 'As peças saem do estoque agora e voltam quando o cliente devolver. Nada é cobrado ainda.'}
        </p>
        {#if problem}<div class="alert warn">{problem}</div>{/if}
      {/if}
    {:else if loading}
      <p class="muted empty">Carregando…</p>
    {:else if !list.length}
      <p class="muted empty">Nenhuma reserva nem condicional em aberto.</p>
    {:else}
      <div class="rows">
        {#each list as c (c.id)}
          <button class="line pickable" onclick={() => settle(c)}>
            <span class="what">
              <strong>#{c.code} · {c.customer?.name ?? 'Cliente'} <em class:res={c.kind === 'reservation'}>{c.kind === 'reservation' ? 'Reserva' : 'Condicional'}</em></strong>
              <small>{c.pieces} {c.pieces === 1 ? 'peça' : 'peças'} · {c.items.map((i) => i.name).slice(0, 2).join(', ')}{c.items.length > 2 ? '…' : ''}</small>
              <small class:late={c.overdue}
                >{c.overdue ? (c.kind === 'reservation' ? 'Vencida · era até' : 'Atrasado · era para') : c.kind === 'reservation' ? 'Guardar até' : 'Devolver até'}
                {fmtDate(c.due_date)}{c.seller ? ` · ${c.seller}` : ''}</small
              >
            </span>
            <strong class="num">{fmt(c.total)}</strong>
          </button>
        {/each}
      </div>
      <p class="muted">Clique no cliente que voltou para marcar o que ele leva e o que volta ao estoque.</p>
    {/if}
  {/if}
  {#if error}<div class="alert danger">{error}</div>{/if}
</Modal>

{#if picking}
  <CustomerPicker
    onclose={() => (picking = false)}
    onpick={(c) => {
      oncustomer(c)
      picking = false
    }}
  />
{/if}

<style>
  .tabs {
    display: flex;
    gap: 4px;
    padding: 4px;
    margin-bottom: 12px;
    background: var(--soft);
    border-radius: 12px;
  }
  .tabs button {
    flex: 1;
    height: 34px;
    border: 0;
    background: transparent;
    border-radius: 9px;
    color: #475569;
  }
  .tabs button.on {
    background: #fff;
    color: var(--brand);
    font-weight: 700;
    box-shadow: 0 1px 2px rgb(15 23 42 / 8%);
  }
  .kinds {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .kinds button {
    height: auto;
    padding: 10px 12px;
    display: grid;
    gap: 2px;
    justify-items: start;
    justify-content: stretch;
    text-align: left;
  }
  .kinds button.on {
    border-color: var(--brand);
    box-shadow: inset 0 0 0 1px var(--brand);
    color: var(--brand);
  }
  .kinds small {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
  }
  .what em {
    margin-left: 4px;
    padding: 1px 7px;
    border-radius: 999px;
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
    background: var(--soft);
    color: var(--muted);
  }
  .what em.res {
    background: var(--brand-50, #eef2ff);
    color: var(--brand);
  }
  .rows {
    display: grid;
    gap: 6px;
    max-height: 300px;
    overflow: auto;
    margin: 10px 0;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: #fff;
  }
  .line.back {
    background: var(--soft);
  }
  .line.back .what strong {
    color: var(--muted);
    text-decoration: line-through;
  }
  .line.bad {
    border-color: var(--danger);
  }
  .line.pickable {
    height: auto;
    width: 100%;
    text-align: left;
    justify-content: space-between;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .what strong {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .what small {
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .what small.late {
    color: var(--danger);
    font-weight: 700;
  }
  .state {
    flex: none;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
  }
  .num {
    flex: none;
    font-weight: 800;
  }
  .sum {
    margin: 0 0 12px;
    text-align: right;
    font-weight: 800;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 180px;
    gap: 12px;
    align-items: end;
    margin-bottom: 12px;
  }
  .who {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .lbl {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .pick {
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
  }
  .pick strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pick small {
    color: var(--muted);
    white-space: nowrap;
  }
  .pick .muted {
    margin-left: auto;
    font-size: 12px;
  }
  .stepper {
    flex: none;
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
  .empty {
    padding: 28px 0;
    text-align: center;
  }
  .row {
    display: flex;
    gap: 16px;
  }
</style>
