import { Api, type Seller, type TerminalInfo } from './api'
import { loadSettings, saveSettings, type Settings } from './settings'

const TOKEN_KEY = 'credix-desktop.terminal-token'
const INFO_KEY = 'credix-desktop.terminal-info'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Sem armazenamento: vale só enquanto o app estiver aberto.
  }
}

/**
 * Estado do caixa.
 * - O computador fica pareado com a loja (token do terminal, guardado até
 *   alguém desconectar).
 * - Quem vende entra com o PIN; após X minutos sem uso, volta a tela de PIN.
 *   O PIN fica só na memória.
 */
class Session {
  settings = $state<Settings>(loadSettings())
  token = $state<string | null>(read<string>(TOKEN_KEY))
  info = $state<TerminalInfo | null>(read<TerminalInfo>(INFO_KEY))
  seller = $state<Seller | null>(null)
  private pin: string | null = null

  /** Último toque do caixa (teclado/mouse), para o bloqueio por inatividade. */
  lastActivity = $state(Date.now())
  /** Operações que não podem ser interrompidas pelo bloqueio (Pix aguardando). */
  busy = $state(0)

  api = $derived(
    new Api(
      this.settings.serverUrl,
      () => ({ token: this.token, sellerId: this.seller?.id ?? null, pin: this.pin }),
      () => this.unpair(),
      () => this.lock(),
    ),
  )

  paired = $derived(!!this.token)
  company = $derived(this.info?.company ?? null)
  pixOnline = $derived(this.info?.company.pix_online ?? false)
  lockMinutes = $derived(Math.max(1, this.info?.terminal.lock_minutes ?? 5))

  updateSettings(next: Settings) {
    this.settings = { ...next }
    saveSettings(this.settings)
  }

  /** Atualiza loja e vendedores (ao abrir e na tela de PIN). */
  async refresh() {
    if (!this.token) return
    try {
      this.setInfo(await this.api.terminal())
    } catch {
      // Sem internet: segue com a última lista guardada.
    }
  }

  private setInfo(info: TerminalInfo) {
    this.info = info
    write(INFO_KEY, info)
  }

  async pair(code: string) {
    const deviceName = navigator.userAgent.includes('Windows')
      ? 'Windows'
      : navigator.userAgent.includes('Mac')
        ? 'macOS'
        : 'Computador'
    const res = await this.api.pair(code, deviceName)
    const { token, ...info } = res
    this.token = token
    write(TOKEN_KEY, token)
    this.setInfo(info)
  }

  async unlock(seller: Seller, pin: string) {
    const res = await this.api.unlock(seller.id, pin)
    this.pin = pin
    this.seller = res.seller
    this.touch()
  }

  lock() {
    this.seller = null
    this.pin = null
  }

  touch() {
    this.lastActivity = Date.now()
  }

  /** Desconecta com o PIN de dono/gerente; o computador volta para o pareamento. */
  async disconnect(manager: Seller, pin: string) {
    await this.api.disconnect(manager.id, pin)
    this.unpair()
  }

  unpair() {
    this.lock()
    this.token = null
    this.info = null
    write(TOKEN_KEY, null)
    write(INFO_KEY, null)
  }
}

export const session = new Session()
