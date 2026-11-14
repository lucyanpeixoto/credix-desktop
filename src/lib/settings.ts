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
  /** Imprime o cupom sozinho ao fechar a venda ou o recebimento. */
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
}

const KEY = 'credix-desktop.settings'

export const defaults: Settings = {
  serverUrl: 'https://pdv.lucyan.dev',
  printerMode: 'none',
  printerHost: '',
  printerPort: 9100,
  printerName: '',
  paperColumns: 48,
  autoPrint: true,
  openDrawer: true,
  carnePrinter: '',
  carneDx: 0,
  carneDy: 0,
  carneBold: false,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults }
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
