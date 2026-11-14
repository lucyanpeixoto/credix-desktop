import { Api, type CashState, type Seller, type TerminalInfo } from './api'
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
  /** Vendedor que acabou de digitar o PIN, enquanto o caixa é conferido. */
  private pendingSellerId: string | null = null

  /** Último toque do caixa (teclado/mouse), para o bloqueio por inatividade. */
  lastActivity = $state(Date.now())
  /** Operações que não podem ser interrompidas pelo bloqueio (Pix aguardando). */
  busy = $state(0)

  /** Conexão com o servidor do Credix (não só "tem internet"). */
  online = $state(true)
  lastCheck = $state<number | null>(null)

  /** Caixa (abertura/fechamento), quando a loja usa. */
  cash = $state<CashState | null>(null)
  /** Depois do fechamento da loja: caixa em que o vendedor escolheu continuar lançando. */
  cashConfirmed = $state<string | null>(null)
  /** O servidor pediu para escolher onde lançar (venda depois do fechamento). */
  askAfterHours = $state(false)

  api = $derived(
    new Api(
      this.settings.serverUrl,
      () => ({
        token: this.token,
        sellerId: this.seller?.id ?? this.pendingSellerId,
        pin: this.pin,
        cashConfirm: this.cashConfirmed,
      }),
      () => this.unpair(),
      () => this.lock(),
      (ok) => this.setOnline(ok),
      (code) => {
        if (code === 'cash_after_hours') this.askAfterHours = true
        this.loadCash()
      },
    ),
  )

  paired = $derived(!!this.token)
  company = $derived(this.info?.company ?? null)
  pixOnline = $derived(this.info?.company.pix_online ?? false)
  lockMinutes = $derived(Math.max(1, this.info?.terminal.lock_minutes ?? 5))
  /** A loja usa abertura de caixa e ele está fechado: precisa abrir para vender. */
  needsCashOpen = $derived(!!this.cash?.enabled && !this.cash?.session)
  /** Caixa esquecido aberto de outro dia: precisa fechar (e abrir o de hoje) para vender. */
  needsCashClose = $derived(!!this.cash?.enabled && !!this.cash?.session?.stale)
  /** Venda e recebimento parados até abrir ou fechar o caixa. */
  cashBlocked = $derived(this.needsCashOpen || this.needsCashClose)

  private setOnline(ok: boolean) {
    this.online = ok
    this.lastCheck = Date.now()
  }

  /** Confere se o servidor responde (rota /up do Laravel), com limite de 5 s. */
  async ping() {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    try {
      // no-cors: o /up não libera CORS para o app; basta o servidor responder
      // (a resposta fica opaca, mas sem internet o fetch falha).
      await fetch(`${this.settings.serverUrl.replace(/\/+$/, '')}/up`, { signal: ctrl.signal, cache: 'no-store', mode: 'no-cors' })
      this.setOnline(true)
    } catch {
      this.setOnline(false)
    } finally {
      clearTimeout(t)
    }
  }

  async loadCash() {
    if (!this.seller) return
    try {
      this.cash = await this.api.cash()
    } catch {
      // Sem conexão: mantém o último estado conhecido.
    }
  }

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
    // Confere o caixa ANTES de entrar: sem isso a tela de venda aparecia e só
    // depois era trocada por "Abrir caixa".
    this.pendingSellerId = res.seller.id
    try {
      this.cash = this.info?.company.cash_control === false ? null : await this.api.cash()
    } catch {
      this.cash = null
    } finally {
      this.pendingSellerId = null
    }
    this.seller = res.seller
    this.touch()
  }

  /** Depois do fechamento: segue lançando no caixa aberto (vale para o resto da noite). */
  keepCash() {
    this.cashConfirmed = this.cash?.session?.id ?? null
    this.askAfterHours = false
  }

  lock() {
    this.seller = null
    this.pin = null
    this.cash = null
    this.askAfterHours = false
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
