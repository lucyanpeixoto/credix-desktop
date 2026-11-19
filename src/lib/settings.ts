// Configurações do terminal, gravadas no próprio computador.

export type PrinterMode = 'none' | 'network' | 'system'

export interface Settings {
  serverUrl: string
  printerMode: PrinterMode
  /** Impressora de rede: IP ou nome (porta 9100 por padrão). */
  printerHost: string
  printerPort: number
  /** Impressora instalada no sistema (USB): nome como aparece no Windows/macOS. */
  printerName: string
  /** Colunas da bobina: 48 para 80 mm, 32 para 58 mm. */
  paperColumns: number
  /** Imprime o cupom sozinho ao fechar a venda ou o recebimento (desligado por padrão). */
  autoPrint: boolean
  /** Abre a gaveta quando entra dinheiro. */
  openDrawer: boolean
  /** Matricial do carnê (LX-300), instalada no computador; vazio = sem carnê. */
  carnePrinter: string
  /** Ajuste fino do carnê no formulário, em mm (+ direita / + desce). */
  carneDx: number
  carneDy: number
  /** Negrito no carnê (fita gasta). */
  carneBold: boolean
  /** Produtos na tela de venda: em cards ou em lista. */
  catalogView: 'cards' | 'list'
  /** Migrações já aplicadas às configurações gravadas. */
  rev: number
}

const KEY = 'credix-desktop.settings'

export const defaults: Settings = {
  serverUrl: 'https://pdv.lucyan.dev',
  printerMode: 'none',
  printerHost: '',
  printerPort: 9100,
  printerName: '',
  paperColumns: 48,
  autoPrint: false,
  openDrawer: true,
  carnePrinter: '',
  carneDx: 0,
  carneDy: 0,
  carneBold: false,
  catalogView: 'cards',
  rev: 1,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const s: Settings = { ...defaults, rev: 0, ...JSON.parse(raw) }
    // 0.2.23: a impressão automática passou a vir desligada; desliga uma vez
    // nos caixas que já estavam com ela ligada (quem quiser religa no F12).
    if (s.rev < 1) {
      s.autoPrint = false
      s.rev = 1
      saveSettings(s)
    }
    return s
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Sem armazenamento: vale só nesta sessão.
  }
}
