<script lang="ts">
  import type { Customer } from '../api'
  import { session } from '../session.svelte'
  import Modal from './Modal.svelte'

  let { onpick, onclose }: { onpick: (c: Customer) => void; onclose: () => void } = $props()

  let search = $state('')
  let results = $state<Customer[]>([])
  let active = $state(0)
  let loading = $state(false)
  let error = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  function onInput() {
    clearTimeout(timer)
    timer = setTimeout(load, 250)
  }

  async function load() {
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
</script>

<Modal title="Cliente" {onclose} width="640px">
  <!-- svelte-ignore a11y_autofocus -->
  <input
    autofocus
    placeholder="Nome, CPF ou código do cliente"
    bind:value={search}
    oninput={onInput}
    onkeydown={keydown}
  />
  {#if error}<div class="alert">{error}</div>{/if}
  <div class="list">
    {#each results as c, i (c.id)}
      <button class="item" class:active={i === active} onclick={() => onpick(c)} onmouseenter={() => (active = i)}>
        <div>
          <strong>{c.name}</strong>
          <div class="muted small">
            {#if c.code}#{c.code} · {/if}{c.cpf_formatted ?? 'sem CPF'}{#if c.phone_formatted} · {c.phone_formatted}{/if}
          </div>
        </div>
        {#if c.overdue_count}
          <span class="badge late">{c.overdue_count} em atraso</span>
        {/if}
      </button>
    {:else}
      <p class="muted small">
        {loading ? 'Buscando…' : search.trim().length < 2 ? 'Digite ao menos 2 letras.' : 'Nenhum cliente encontrado.'}
      </p>
    {/each}
  </div>
</Modal>

<style>
  .list {
    display: grid;
    gap: 4px;
    max-height: 50vh;
    overflow: auto;
  }
  .item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-align: left;
    border-color: transparent;
  }
  .item.active {
    background: #eef4ff;
    border-color: #c7dbff;
  }
  .small {
    font-size: 13px;
  }
</style>
