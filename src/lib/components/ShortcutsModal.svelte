<script lang="ts">
  import Modal from './Modal.svelte'

  let { cash, onclose }: { cash: boolean; onclose: () => void } = $props()

  /** Espelha os tratadores de teclado das telas: mudou um atalho lá, muda aqui. */
  const ALL: { title: string; keys: [string, string][] }[] = [
    {
      title: 'Em qualquer tela',
      keys: [
        ['F1', 'Venda'],
        ['F2', 'Receber'],
        ['F5', 'Vendas (consulta)'],
        ['F8', 'Caixa: sangria, suprimento e fechamento'],
        ['F11', 'Trocar vendedor (ou Ctrl+L)'],
        ['F12', 'Configurações e impressoras'],
        ['Esc', 'Fecha a janela aberta'],
        ['?', 'Esta lista (ou Ctrl+/)'],
      ],
    },
    {
      title: 'Venda',
      keys: [
        ['F3', 'Buscar produto'],
        ['F4', 'Escolher o cliente'],
        ['F6', 'Item avulso'],
        ['F7', 'Desconto'],
        ['Shift+F7', 'Alterar o total'],
        ['F9', 'Finalizar venda'],
        ['F10', 'Consultar preço'],
        ['Ctrl+E', 'Pôr em espera ou retomar'],
        ['Ctrl+T', 'Troca'],
        ['Ctrl+Del', 'Cancelar a venda'],
      ],
    },
    {
      title: 'Finalização',
      keys: [
        ['1 a 7', 'Forma de pagamento (Alt+1 a 7 com o cursor num campo)'],
        ['F9', 'Confirmar a venda'],
        ['P', 'Imprimir o comprovante, depois de concluída'],
        ['Enter', 'Nova venda, depois de concluída'],
      ],
    },
    {
      title: 'Receber',
      keys: [
        ['F4', 'Buscar ou trocar o cliente'],
        ['F9', 'Confirmar o recebimento'],
        ['P', 'Imprimir o comprovante, depois de concluído'],
        ['Enter', 'Novo recebimento, depois de concluído'],
      ],
    },
    {
      title: 'Vendas (consulta)',
      keys: [
        ['F3', 'Buscar'],
        ['↑ ↓', 'Andar pela lista'],
        ['P', 'Imprimir o comprovante da venda aberta'],
      ],
    },
  ]

  /** Sem caixa aberto nesta loja, o F8 não faz nada: não aparece na lista. */
  const GROUPS = $derived(ALL.map((g) => ({ ...g, keys: g.keys.filter(([k]) => cash || k !== 'F8') })))
</script>

<Modal title="Atalhos do teclado" {onclose} width="860px">
  <div class="cols">
    {#each GROUPS as g (g.title)}
      <section>
        <h3>{g.title}</h3>
        {#each g.keys as [key, what] (key + what)}
          <div class="line"><kbd>{key}</kbd><span>{what}</span></div>
        {/each}
      </section>
    {/each}
  </div>
</Modal>

<style>
  .cols {
    columns: 2;
    column-gap: 28px;
  }
  @media (max-width: 760px) {
    .cols {
      columns: 1;
    }
  }
  section {
    break-inside: avoid;
    margin-bottom: 18px;
  }
  h3 {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--label);
    margin-bottom: 6px;
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 0;
    font-size: 14px;
    color: var(--ink-2);
  }
  kbd {
    flex: none;
    min-width: 64px;
    text-align: center;
    font-size: 12px;
    padding: 3px 6px;
    color: var(--ink);
  }
</style>
