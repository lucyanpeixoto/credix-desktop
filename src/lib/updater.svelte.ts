// Atualização automática do Credix PDV (plugin updater do Tauri).
// Confere ao abrir e a cada 2 h; baixa em segundo plano e só reinicia quando
// alguém pedir (ou quando o caixa estiver na tela de PIN), para não
// interromper uma venda.
import { inTauri } from './printer'

type Update = Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>>

const EVERY_MS = 2 * 60 * 60 * 1000

class Updater {
  /** Versão nova já baixada e pronta para instalar. */
  ready = $state<string | null>(null)
  notes = $state<string | null>(null)
  installing = $state(false)
  error = $state('')

  private update: Update = null
  private checking = false
  private timer: ReturnType<typeof setInterval> | undefined

  start() {
    if (!inTauri() || this.timer) return
    this.check()
    this.timer = setInterval(() => this.check(), EVERY_MS)
  }

  async check() {
    if (this.checking || this.ready) return
    this.checking = true
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        await update.download()
        this.update = update
        this.notes = update.body ?? null
        this.ready = update.version
      }
    } catch (e) {
      // Sem internet ou sem release publicada: tenta de novo mais tarde.
      console.warn('[updater]', e)
    } finally {
      this.checking = false
    }
  }

  /** Instala a versão baixada e reinicia o app. */
  async install() {
    if (!this.update || this.installing) return
    this.installing = true
    this.error = ''
    try {
      await this.update.install()
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      this.error = `Não foi possível atualizar: ${String((e as Error)?.message ?? e)}`
      this.installing = false
    }
  }
}

export const updater = new Updater()
