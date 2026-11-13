// Impressão com as configurações do terminal; nunca derruba a venda se falhar.
import type { CashMovement, CashSession, Receipt, Sale } from './api'
import { cashCloseTicket, movementTicket, printerReady, receiptTicket, saleTicket, sendToPrinter } from './printer'
import { session } from './session.svelte'

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

export async function printSale(sale: Sale, opts: { cashTendered?: number; drawer?: boolean } = {}): Promise<PrintResult> {
  const s = session.settings
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
