<script lang="ts">
  import { session } from '../session.svelte'
  import Icon from '../ui/Icon.svelte'
  import { updater } from '../updater.svelte'

  let { dark = false }: { dark?: boolean } = $props()

  function install() {
    // Com Pix aguardando, não reinicia: a cobrança seria perdida da tela.
    if (session.busy > 0) return
    updater.install()
  }
</script>

{#if updater.ready}
  <button
    class="upd"
    class:dark
    onclick={install}
    disabled={updater.installing || session.busy > 0}
    title={updater.notes ?? `Versão ${updater.ready} baixada. O app reinicia para atualizar.`}
  >
    <Icon name="arrowDown" size={14} />
    {updater.installing ? 'Atualizando…' : `Atualizar para ${updater.ready}`}
  </button>
  {#if updater.error}<span class="err">{updater.error}</span>{/if}
{/if}

<style>
  .upd {
    height: 30px;
    padding: 0 12px;
    gap: 6px;
    border-radius: 999px;
    border: 0;
    font-size: 12px;
    font-weight: 700;
    background: var(--brand);
    color: #fff;
  }
  .upd:hover:not(:disabled) {
    background: var(--brand-ink);
  }
  .upd.dark {
    background: #fff;
    color: var(--brand);
  }
  .err {
    font-size: 12px;
    color: var(--danger);
  }
</style>
