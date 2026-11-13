<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { modalStack } from './modalStack'

  let {
    title,
    onclose,
    width = '520px',
    children,
    footer,
  }: { title: string; onclose: () => void; width?: string; children: Snippet; footer?: Snippet } = $props()

  const id = Symbol()
  onMount(() => modalStack.push(id))

  function keydown(e: KeyboardEvent) {
    // Com um modal sobre outro, o Esc fecha só o de cima.
    if (e.key === 'Escape' && modalStack.isTop(id)) {
      e.preventDefault()
      e.stopPropagation()
      onclose()
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal panel" style:width role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <h2>{title}</h2>
      <button class="ghost" onclick={onclose} aria-label="Fechar">✕<kbd>Esc</kbd></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(16 24 40 / 45%);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .modal {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgb(0 0 0 / 25%);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    font-size: 18px;
  }
  .body {
    padding: 18px;
    overflow: auto;
    display: grid;
    gap: 14px;
  }
  footer {
    padding: 14px 18px;
    border-top: 1px solid var(--line);
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
</style>
