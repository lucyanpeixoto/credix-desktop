import { Api, type User } from './api'
import { loadSettings, saveSettings, type Settings } from './settings'

const TOKEN_KEY = 'credix-desktop.token'

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Sem armazenamento: o login vale só enquanto o app estiver aberto.
  }
}

class Session {
  settings = $state<Settings>(loadSettings())
  user = $state<User | null>(null)
  token = $state<string | null>(readToken())
  /** true enquanto confere um token salvo ao abrir o app. */
  restoring = $state(false)

  api = $derived(new Api(this.settings.serverUrl, this.token, () => this.clear()))

  isSeller = $derived(this.user?.roles.includes('seller') ?? false)
  pixOnline = $derived(this.user?.company?.pix_online ?? false)

  updateSettings(next: Settings) {
    this.settings = { ...next }
    saveSettings(this.settings)
  }

  async restore() {
    if (!this.token) return
    this.restoring = true
    try {
      this.user = (await this.api.me()).user
    } catch {
      this.clear()
    } finally {
      this.restoring = false
    }
  }

  async login(email: string, password: string) {
    const res = await this.api.login(email, password)
    this.token = res.token
    this.user = res.user
    writeToken(res.token)
  }

  async logout() {
    try {
      await this.api.logout()
    } catch {
      // Token já inválido: sai do mesmo jeito.
    }
    this.clear()
  }

  clear() {
    this.token = null
    this.user = null
    writeToken(null)
  }
}

export const session = new Session()
