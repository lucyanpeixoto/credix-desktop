<script lang="ts">
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import Modal from './Modal.svelte'

  // Venda depois do fechamento da loja: lança no caixa aberto ou fecha e abre o do dia seguinte.
  let { onclosecash }: { onclosecash: () => void } = $props()

  const cash = $derived(session.cash?.session ?? null)
  const closes = $derived(session.company?.closing_time ?? null)
  const opened = $derived(
    cash ? new Date(cash.opened_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
  )

  function closeAndOpen() {
    session.askAfterHours = false
    onclosecash()
  }
</script>

{#snippet footer()}
  <button onclick={closeAndOpen}><Icon name="lock" size={16} /> Fechar e abrir o de amanhã</button>
  <span class="spacer"></span>
  <button class="primary" onclick={() => session.keepCash()}>Lançar neste caixa</button>
{/snippet}

<Modal title="A loja já fechou" onclose={() => (session.askAfterHours = false)} width="520px" {footer}>
  <p>
    {closes ? `A loja fecha às ${closes}.` : 'Já passou do horário da loja.'} Esta venda pode entrar no caixa aberto em {opened}
    ou ficar para o dia seguinte: aí você fecha este caixa agora, contando a gaveta, e abre o de amanhã.
  </p>
  <p class="muted small">Escolhendo "Lançar neste caixa", não pergunta de novo hoje. Depois é só finalizar de novo.</p>
</Modal>
