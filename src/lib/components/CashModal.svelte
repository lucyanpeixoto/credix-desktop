<script lang="ts">
  import { onMount } from 'svelte'
  import type { CashSession } from '../api'
  import { Attempt } from '../attempt'
  import { fmt, parseMoney } from '../money'
  import { printCashClose, printMovement, type PrintResult } from '../print'
  import { printerReady } from '../printer'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import Modal from './Modal.svelte'

  type View = 'summary' | 'sangria' | 'suprimento' | 'close' | 'closed'

  let { onclose, start = 'summary' }: { onclose: () => void; start?: View } = $props()

  // svelte-ignore state_referenced_locally
  let view = $state<View>(start)
  let amount = $state('')
  let reason = $state('')
  let counted = $state('')
  let notes = $state('')
  let saving = $state(false)
  let error = $state('')
  let print = $state<PrintResult | null>(null)
  let closed = $state<CashSession | null>(null)
  const attempt = new Attempt()

  const cash = $derived(session.cash?.session ?? null)
  const sum = $derived(cash?.summary ?? null)
  // Às cegas, o dinheiro (e o esperado) só aparecem depois de fechar.
  const blind = $derived(sum?.expected_cash === null)
  const visibleMethods = $derived((sum?.methods ?? []).filter((m) => m.total !== null && (m.count > 0 || m.type === 'dinheiro')))
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  // Caixa de outro dia mostra a data junto, para não parecer que abriu hoje.
  const openedLabel = (iso: string) => {
    const d = new Date(iso)
    return d.toDateString() === new Date().toDateString()
      ? `às ${time(iso)}`
      : `em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time(iso)}`
  }

  onMount(() => session.loadCash())

  function go(v: View) {
    view = v
    amount = ''
    reason = ''
    counted = ''
    notes = ''
    error = ''
    print = null
  }

  async function move(e: SubmitEvent) {
    e.preventDefault()
    const value = parseMoney(amount)
    if (saving || value <= 0 || (view !== 'sangria' && view !== 'suprimento')) return
    saving = true
    error = ''
    try {
      const why = reason.trim() || null
      const res = await session.api.cashMovement(view, value, why, attempt.keyFor([view, value, why]))
      attempt.reset()
      await session.loadCash()
      const p = printerReady(session.settings) ? await printMovement(res.movement) : null
      go('summary')
      print = p
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }

  async function close(e: SubmitEvent) {
    e.preventDefault()
    if (saving || !counted.trim()) return
    saving = true
    error = ''
    try {
      const res = await session.api.closeCash(parseMoney(counted), notes.trim() || null)
      closed = res.session
      view = 'closed'
      if (printerReady(session.settings)) print = await printCashClose(res.session)
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }

  async function finish() {
    // Caixa fechado: volta para a tela de abertura.
    await session.loadCash()
    onclose()
  }
</script>

{#snippet summaryFooter()}
  <button onclick={() => go('suprimento')}><Icon name="arrowDown" size={16} /> Suprimento</button>
  <button onclick={() => go('sangria')}><Icon name="arrowUp" size={16} /> Sangria</button>
  <span class="spacer"></span>
  <button class="primary" onclick={() => go('close')}><Icon name="lock" size={16} /> Fechar caixa</button>
{/snippet}

{#snippet moveFooter()}
  <button onclick={() => go('summary')}>Voltar</button>
  <button class="primary" type="submit" form="move" disabled={saving || parseMoney(amount) <= 0}>
    {saving ? 'Registrando…' : 'Registrar'}
  </button>
{/snippet}

{#snippet closeFooter()}
  <button onclick={() => go('summary')}>Voltar</button>
  <button class="primary" type="submit" form="close" disabled={saving || !counted.trim()}>
    {saving ? 'Fechando…' : 'Fechar caixa'}
  </button>
{/snippet}

{#snippet closedFooter()}
  {#if closed && printerReady(session.settings)}
    <button onclick={async () => closed && (print = await printCashClose(closed))}>Imprimir de novo</button>
  {/if}
  <button class="primary" onclick={finish}>Pronto</button>
{/snippet}

<Modal
  title={view === 'sangria' ? 'Sangria' : view === 'suprimento' ? 'Suprimento' : view === 'close' ? 'Fechar caixa' : view === 'closed' ? 'Caixa fechado' : `Caixa · ${session.info?.terminal.name ?? ''}`}
  onclose={view === 'closed' ? finish : onclose}
  width="560px"
  footer={view === 'summary' && cash ? summaryFooter : view === 'close' ? closeFooter : view === 'closed' ? closedFooter : view === 'summary' ? undefined : moveFooter}
>
  {#if view === 'closed' && closed}
    {@const d = closed.difference ?? 0}
    <div class="result" class:ok={d === 0} class:bad={d < 0} class:warn={d > 0}>
      <span>{d === 0 ? 'Caixa bateu' : d < 0 ? 'Falta' : 'Sobra'}</span>
      <strong>{fmt(Math.abs(d))}</strong>
    </div>
    <div class="rows">
      <div class="row"><span class="muted">Dinheiro esperado</span><span class="spacer"></span><strong>{fmt(closed.summary.expected_cash)}</strong></div>
      <div class="row"><span class="muted">Dinheiro contado</span><span class="spacer"></span><strong>{fmt(closed.counted_cash)}</strong></div>
    </div>
    {#if print}<div class="alert" class:ok={print.ok}>{print.ok ? 'Resumo impresso.' : `Não imprimiu: ${print.message}`}</div>{/if}
  {:else if !cash || !sum}
    <p class="muted">Carregando caixa…</p>
  {:else if view === 'summary'}
    <p class="muted small">Aberto {openedLabel(cash.opened_at)} por {cash.opened_by}. O mesmo caixa aparece no Credix web.</p>
    <div class="rows">
      <div class="row"><span class="muted">Troco inicial</span><span class="spacer"></span>{fmt(sum.opening)}</div>
      {#each visibleMethods as m (m.type)}
        <div class="row"><span class="muted">{m.label} <span class="small">({m.count})</span></span><span class="spacer"></span>{fmt(m.total)}</div>
      {/each}
      {#if sum.suprimento > 0}<div class="row"><span class="muted">Suprimentos</span><span class="spacer"></span><span class="green">+ {fmt(sum.suprimento)}</span></div>{/if}
      {#if sum.sangria > 0}<div class="row"><span class="muted">Sangrias</span><span class="spacer"></span><span class="red">− {fmt(sum.sangria)}</span></div>{/if}
      {#if sum.crediario_sold > 0}<div class="row faint"><span>Vendido no crediário (não entra no caixa)</span><span class="spacer"></span>{fmt(sum.crediario_sold)}</div>{/if}
    </div>
    {#if blind}
      <div class="expected blind"><span>Fechamento às cegas</span><small>O dinheiro esperado na gaveta aparece depois que você contar e fechar o caixa.</small></div>
    {:else}
      <div class="expected"><span>Dinheiro na gaveta</span><strong>{fmt(sum.expected_cash)}</strong></div>
    {/if}
    {#if cash.movements.length}
      <div class="moves">
        {#each cash.movements as m (m.id)}
          <div class="row small">
            <span>{m.type === 'sangria' ? 'Sangria' : 'Suprimento'} · {time(m.created_at)} · {m.user}{#if m.reason} · {m.reason}{/if}</span>
            <span class="spacer"></span>
            <span class:red={m.type === 'sangria'} class:green={m.type === 'suprimento'}>{m.type === 'sangria' ? '−' : '+'} {fmt(m.amount)}</span>
          </div>
        {/each}
      </div>
    {/if}
    {#if print}<div class="alert" class:ok={print.ok}>{print.ok ? 'Comprovante impresso.' : `Não imprimiu: ${print.message}`}</div>{/if}
  {:else if view === 'sangria' || view === 'suprimento'}
    <form id="move" class="form" onsubmit={move}>
      <p class="muted">
        {view === 'sangria'
          ? `Dinheiro que sai da gaveta (cofre, depósito).${sum.expected_cash === null ? '' : ` Na gaveta agora: ${fmt(sum.expected_cash)}.`}`
          : 'Dinheiro que entra na gaveta para troco.'}
      </p>
      <!-- svelte-ignore a11y_autofocus -->
      <label>Valor <input class="money" bind:value={amount} inputmode="decimal" placeholder="R$ 0,00" autofocus /></label>
      <label>Motivo (opcional) <input bind:value={reason} maxlength="255" /></label>
      {#if error}<div class="alert">{error}</div>{/if}
    </form>
  {:else if view === 'close'}
    <form id="close" class="form" onsubmit={close}>
      <p class="muted">Conte o dinheiro da gaveta e digite o total. Confira débito, crédito e Pix com a maquininha e o extrato.</p>
      <div class="rows">
        {#each visibleMethods.filter((m) => m.type !== 'dinheiro') as m (m.type)}
          <div class="row"><span class="muted">{m.label} <span class="small">({m.count})</span></span><span class="spacer"></span>{fmt(m.total)}</div>
        {/each}
      </div>
      <!-- svelte-ignore a11y_autofocus -->
      <label>Dinheiro contado na gaveta <input class="money" bind:value={counted} inputmode="decimal" placeholder="R$ 0,00" autofocus /></label>
      <label>Observação (opcional) <input bind:value={notes} maxlength="500" /></label>
      {#if error}<div class="alert">{error}</div>{/if}
    </form>
  {/if}
</Modal>

<style>
  .rows {
    display: grid;
    gap: 6px;
    font-size: 14px;
  }
  .faint {
    color: var(--faint);
    font-size: 13px;
  }
  .green {
    color: var(--ok);
  }
  .red {
    color: var(--danger);
  }
  .expected {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 14px 16px;
    border-radius: 14px;
    background: var(--ok-bg);
    color: var(--ok);
    font-weight: 700;
  }
  .expected.blind {
    display: grid;
    gap: 2px;
    background: var(--soft);
    color: var(--ink-2);
  }
  .expected.blind small {
    font-weight: 500;
    color: var(--muted);
  }
  .expected strong {
    font-size: 28px;
    font-weight: 800;
  }
  .moves {
    display: grid;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--line-soft);
    color: var(--muted);
  }
  .form {
    display: grid;
    gap: 14px;
  }
  .money {
    height: 56px;
    font-size: 22px;
    font-weight: 800;
  }
  .result {
    display: grid;
    justify-items: center;
    padding: 18px;
    border-radius: 16px;
    font-weight: 700;
  }
  .result strong {
    font-size: 36px;
    font-weight: 800;
  }
  .result.ok {
    background: var(--ok-bg);
    color: var(--ok);
  }
  .result.bad {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .result.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
</style>
