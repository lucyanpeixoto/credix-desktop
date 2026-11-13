<script lang="ts">
  import { onMount } from 'svelte'
  import { inTauri, listPrinters, sendToPrinter, testTicket } from '../printer'
  import { session } from '../session.svelte'
  import type { Settings } from '../settings'
  import Modal from './Modal.svelte'

  let { onclose }: { onclose: () => void } = $props()

  let form = $state<Settings>({ ...session.settings })
  let printers = $state<string[]>([])
  let status = $state<{ ok: boolean; text: string } | null>(null)
  let testing = $state(false)

  onMount(async () => {
    try {
      printers = await listPrinters()
    } catch {
      printers = []
    }
  })

  async function test() {
    testing = true
    status = null
    try {
      await sendToPrinter(form, testTicket(form))
      status = { ok: true, text: 'Enviado. Confira se saiu o cupom de teste.' }
    } catch (e) {
      status = { ok: false, text: String((e as Error)?.message ?? e) }
    } finally {
      testing = false
    }
  }

  function save() {
    const serverUrl = form.serverUrl.trim().replace(/\/+$/, '')
    const changed = serverUrl !== session.settings.serverUrl
    session.updateSettings({ ...form, serverUrl })
    onclose()
    // O token é do servidor antigo.
    if (changed) session.clear()
  }
</script>

<Modal title="Configurações do terminal" {onclose} width="560px">
  <h3>Impressora térmica</h3>
  {#if !inTauri()}
    <div class="alert warn">Você está no navegador: a impressão só funciona no app instalado.</div>
  {/if}
  <label>
    Conexão
    <select bind:value={form.printerMode}>
      <option value="none">Sem impressora</option>
      <option value="network">Rede (IP, porta 9100)</option>
      <option value="system">Instalada no computador (USB)</option>
    </select>
  </label>

  {#if form.printerMode === 'network'}
    <div class="grid">
      <label>IP da impressora <input bind:value={form.printerHost} placeholder="192.168.0.50" /></label>
      <label>Porta <input type="number" bind:value={form.printerPort} /></label>
    </div>
  {:else if form.printerMode === 'system'}
    <label>
      Impressora
      {#if printers.length}
        <select bind:value={form.printerName}>
          <option value="">Escolha…</option>
          {#each printers as p (p)}<option value={p}>{p}</option>{/each}
        </select>
      {:else}
        <input bind:value={form.printerName} placeholder="Nome exato da impressora" />
      {/if}
    </label>
    <p class="muted small">
      No Windows, instale a impressora com o driver do fabricante (ou "Generic / Text Only"). O cupom vai em modo RAW.
    </p>
  {/if}

  {#if form.printerMode !== 'none'}
    <div class="grid">
      <label>
        Bobina
        <select bind:value={form.paperColumns}>
          <option value={48}>80 mm (48 colunas)</option>
          <option value={42}>80 mm (42 colunas)</option>
          <option value={32}>58 mm (32 colunas)</option>
        </select>
      </label>
      <div class="end"><button onclick={test} disabled={testing}>{testing ? 'Enviando…' : 'Imprimir teste'}</button></div>
    </div>
    <label class="check"><input type="checkbox" bind:checked={form.autoPrint} /> Imprimir o cupom automaticamente</label>
    <label class="check"><input type="checkbox" bind:checked={form.openDrawer} /> Abrir a gaveta quando entrar dinheiro</label>
    {#if status}<div class="alert" class:ok={status.ok}>{status.text}</div>{/if}
  {/if}

  <h3>Servidor</h3>
  <label>Endereço do Credix <input bind:value={form.serverUrl} /></label>
  <p class="muted small">Trocar o servidor encerra a sessão e pede login de novo.</p>

  {#snippet footer()}
    <button onclick={onclose}>Cancelar</button>
    <button class="primary" onclick={save}>Salvar</button>
  {/snippet}
</Modal>

<style>
  h3 {
    font-size: 15px;
  }
  .grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
  }
  .end {
    display: grid;
    align-content: end;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ink);
    font-size: 14px;
  }
  .check input {
    width: auto;
  }
  .small {
    font-size: 12px;
  }
</style>
