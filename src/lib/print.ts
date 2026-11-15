// Impressão com as configurações do terminal; nunca derruba a venda se falhar.
import type { CashMovement, CashSession, Receipt, Sale } from './api'
import { carneBytes, carneTestBytes, type CarneAdjust } from './carne'
import {
  cashCloseTicket,
  movementTicket,
  openInBrowser,
  printerReady,
  receiptTicket,
  saleTicket,
  sendToPrinter,
  sendToSystemPrinter,
} from './printer'
import { session } from './session.svelte'
import type { Settings } from './settings'

export interface PrintResult {
  ok: boolean
  message?: string
}

const base = () => ({
  company: session.company?.name ?? 'Credix',
  operator: session.seller?.name ?? '',
  address: session.company?.address,
  phone: session.company?.phone,
})

/** Loja sem térmica: venda e recebimento saem em meia folha A4, pelo navegador. */
export const halfSheet = (): boolean => session.company?.receipt_format === 'meia_a4'

/** Dá para imprimir o comprovante da venda/recebimento (térmica configurada ou meia folha). */
export const canPrintReceipt = (s: Settings): boolean => halfSheet() || printerReady(s)

async function openHalfSheet(url: string | undefined): Promise<PrintResult> {
  if (!url) return { ok: false, message: 'O servidor ainda não manda o comprovante em meia folha. Atualize o Credix.' }
  try {
    await openInBrowser(url + (url.includes('?') ? '&' : '?') + 'auto=1')
    return { ok: true, message: 'Comprovante aberto no navegador para imprimir (meia folha A4).' }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

export async function printSale(sale: Sale, opts: { cashTendered?: number; drawer?: boolean } = {}): Promise<PrintResult> {
  const s = session.settings
  if (halfSheet()) return openHalfSheet(sale.half_sheet_url)
  if (!printerReady(s)) return { ok: false, message: 'Nenhuma impressora configurada.' }
  try {
    await sendToPrinter(s, saleTicket(s, sale, { ...base(), cashTendered: opts.cashTendered }, !!opts.drawer && s.openDrawer))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

export async function printReceipt(r: Receipt, customer: string, drawer = false): Promise<PrintResult> {
  const s = session.settings
  if (halfSheet()) return openHalfSheet(r.half_sheet_url)
  if (!printerReady(s)) return { ok: false, message: 'Nenhuma impressora configurada.' }
  try {
    await sendToPrinter(s, receiptTicket(s, r, { ...base(), customer }, drawer && s.openDrawer))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

const cashStore = () => ({ ...base(), terminal: session.info?.terminal.name ?? '' })

export async function printCashClose(c: CashSession): Promise<PrintResult> {
  const s = session.settings
  if (!printerReady(s)) return { ok: false, message: 'Nenhuma impressora configurada.' }
  try {
    await sendToPrinter(s, cashCloseTicket(s, c, cashStore()))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

export async function printMovement(m: CashMovement): Promise<PrintResult> {
  const s = session.settings
  if (!printerReady(s)) return { ok: false, message: 'Nenhuma impressora configurada.' }
  try {
    await sendToPrinter(s, movementTicket(s, m, cashStore(), s.openDrawer))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

// Carnê na matricial (LX-300), com o ajuste fino deste computador.
const carneAdjust = (s: Settings): CarneAdjust => ({ dx: s.carneDx, dy: s.carneDy, bold: s.carneBold })

/** Imprime o carnê das parcelas em aberto da venda. */
export async function printCarne(saleId: string): Promise<PrintResult> {
  const s = session.settings
  try {
    const data = await session.api.carne(saleId)
    if (!data.sheets.length) return { ok: false, message: 'Esta venda não tem parcelas em aberto para o carnê.' }
    await sendToSystemPrinter(s.carnePrinter, carneBytes(data, carneAdjust(s)))
    return { ok: true, message: `${data.sheets.length} ${data.sheets.length === 1 ? 'folha' : 'folhas'} de carnê enviada(s).` }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

/** Página de teste de alinhamento, com as configurações informadas (ainda não salvas). */
export async function printCarneTest(s: Settings): Promise<PrintResult> {
  try {
    const data = await session.api.carneLayout()
    await sendToSystemPrinter(s.carnePrinter, carneTestBytes(data, carneAdjust(s)))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}
