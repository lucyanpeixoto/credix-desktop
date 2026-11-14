<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fmt, parseMoney } from '../money'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  let amount = $state('')
  let amountEl = $state<HTMLInputElement>()

  onMount(async () => {
    await tick()
    amountEl?.focus()
  })
  let saving = $state(false)
  let error = $state('')

  const last = $derived(session.cash?.last_closed ?? null)

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (saving) return
    saving = true
    error = ''
    try {
      await session.api.openCash(parseMoney(amount))
      await session.loadCash()
    } catch (err) {
      error = (err as Error).message
    } finally {
      saving = false
    }
  }
</script>

<div class="wrap">
  <form class="card panel" onsubmit={submit}>
    <span class="icon"><Icon name="cash" size={26} /></span>
    <div>
      <h1>Abrir caixa</h1>
      <p class="muted">{session.info?.terminal.name} · conte o dinheiro que está na gaveta para começar.</p>
    </div>

    <label>
      Troco inicial
      <input class="money" bind:this={amountEl} bind:value={amount} inputmode="decimal" placeholder="R$ 0,00" />
    </label>
    {#if last}
      <p class="muted small">
        Último fechamento: {new Date(last.closed_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        {#if last.closed_by}por {last.closed_by}{/if} · contado {fmt(last.counted_cash)}
      </p>
    {/if}

    {#if error}<div class="alert">{error}</div>{/if}

    <button class="primary big" type="submit" disabled={saving}>{saving ? 'Abrindo…' : 'Abrir caixa'}</button>
    <p class="muted small center">O caixa é o mesmo do Credix web: se alguém já abriu por lá, ele aparece aberto aqui.</p>
  </form>
</div>

<style>
  .wrap {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: 420px;
    padding: 32px;
    display: grid;
    gap: 18px;
    border-radius: 24px;
  }
  .icon {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--ok-bg);
    color: var(--ok);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h1 {
    font-size: 22px;
    font-weight: 800;
  }
  .money {
    height: 60px;
    font-size: 26px;
    font-weight: 800;
  }
  .center {
    text-align: center;
  }
</style>
