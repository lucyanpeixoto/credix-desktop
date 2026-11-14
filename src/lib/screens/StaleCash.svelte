<script lang="ts">
  import CashModal from '../components/CashModal.svelte'
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'

  // Caixa esquecido aberto de outro dia: fecha (contando a gaveta) e depois abre o de hoje.
  let closing = $state(false)

  const cash = $derived(session.cash?.session ?? null)
  const opened = $derived(cash ? new Date(cash.opened_at) : null)
  const day = $derived(opened?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) ?? '')
  const when = $derived(
    opened ? opened.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
  )
</script>

<div class="wrap">
  <div class="card panel">
    <span class="icon"><Icon name="alert" size={26} /></span>
    <div>
      <h1>Feche o caixa de {day}</h1>
      <p class="muted">
        O caixa aberto {when}{cash?.opened_by ? ` por ${cash.opened_by}` : ''} não foi fechado. Conte o dinheiro da gaveta e feche
        esse caixa; depois é só abrir o de hoje.
      </p>
    </div>
    <button class="primary big" onclick={() => (closing = true)}><Icon name="lock" size={18} /> Fechar caixa de {day}</button>
    <p class="muted small center">Assim as vendas de hoje não se misturam com as do outro dia na conferência.</p>
  </div>
</div>

{#if closing}
  <CashModal start="close" onclose={() => (closing = false)} />
{/if}

<style>
  .wrap {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: 440px;
    padding: 32px;
    display: grid;
    gap: 18px;
    border-radius: 24px;
  }
  .icon {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--danger-bg);
    color: var(--danger);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h1 {
    font-size: 22px;
    font-weight: 800;
  }
  .center {
    text-align: center;
  }
</style>
