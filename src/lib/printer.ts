import { invoke } from '@tauri-apps/api/core'
import type { CashMovement, CashSession, Receipt, Sale } from './api'
import { Ticket } from './escpos'
import { fmt, fmtDate, PAYMENT_LABELS } from './money'
import type { Settings } from './settings'

export const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const printerReady = (s: Settings): boolean =>
  s.printerMode === 'network' ? !!s.printerHost.trim() : s.printerMode === 'system' ? !!s.printerName.trim() : false

export async function sendToPrinter(s: Settings, bytes: number[]): Promise<void> {
  if (!inTauri()) throw new Error('A impressão só funciona no app instalado.')
  if (s.printerMode === 'network') {
    await invoke('print_network', { host: s.printerHost.trim(), port: Number(s.printerPort) || 9100, data: bytes })
  } else if (s.printerMode === 'system') {
    await invoke('print_system', { printer: s.printerName.trim(), data: bytes })
  } else {
    throw new Error('Nenhuma impressora configurada.')
  }
}

export async function listPrinters(): Promise<string[]> {
  if (!inTauri()) return []
  return invoke<string[]>('list_printers')
}

export interface StoreInfo {
  company: string
  operator: string
  address?: string | null
  phone?: string | null
}

function header(t: Ticket, store: StoreInfo, title: string) {
  t.align('center').bold(true).big(true).line(store.company).big(false).bold(false)
  if (store.address) t.wrap(store.address)
  if (store.phone) t.line(store.phone)
  t.bold(true).line(title).bold(false).align('left').rule()
}

export interface SaleTicketExtra extends StoreInfo {
  cashTendered?: number
}

export function saleTicket(s: Settings, sale: Sale, extra: SaleTicketExtra, openDrawer = false): number[] {
  const t = new Ticket(s.paperColumns)
  if (openDrawer) t.drawer()
  header(t, extra, `VENDA #${sale.code}`)
  t.line(sale.created_at_formatted)
  if (sale.customer) t.line(`Cliente: ${sale.customer.name}`)
  t.rule()
  for (const it of sale.items ?? []) {
    t.wrap(it.product_name)
    t.pair(`  ${it.quantity} x ${fmt(it.unit_price)}`, fmt(it.subtotal))
  }
  t.rule()
  if (sale.discount > 0) {
    t.pair('Subtotal', fmt(sale.subtotal))
    t.pair('Desconto', `-${fmt(sale.discount)}`)
  }
  t.bold(true).pair('TOTAL', fmt(sale.total)).bold(false)
  t.pair('Pagamento', PAYMENT_LABELS[sale.payment_type] ?? sale.payment_type)
  if (extra.cashTendered && extra.cashTendered > sale.total) {
    t.pair('Recebido', fmt(extra.cashTendered))
    t.pair('Troco', fmt(extra.cashTendered - sale.total))
  }
  const inst = sale.installments ?? []
  if (sale.payment_type === 'crediario' && inst.length) {
    t.rule().line('Parcelas:')
    for (const i of inst) {
      const paid = i.status === 'paid' ? ' (paga)' : ''
      t.pair(`  ${i.installment_number}a - ${fmtDate(i.due_date)}${paid}`, fmt(i.amount))
    }
  }
  t.rule().align('center').line(`Vendedor: ${extra.operator}`).line('Nao e documento fiscal').align('left')
  return t.cut().build()
}

export function receiptTicket(
  s: Settings,
  r: Receipt,
  extra: StoreInfo & { customer: string },
  openDrawer = false,
): number[] {
  const t = new Ticket(s.paperColumns)
  if (openDrawer) t.drawer()
  header(t, extra, `RECEBIMENTO #${r.code}`)
  t.line(new Date(r.created_at).toLocaleString('pt-BR'))
  t.line(`Cliente: ${extra.customer}`).rule()
  t.pair('Parcelas', fmt(r.principal))
  if (r.surcharge > 0) t.pair('Juros/multa', fmt(r.surcharge))
  if (r.surcharge_waived > 0) t.pair('Juros dispensados', `-${fmt(r.surcharge_waived)}`)
  if (r.discount > 0) t.pair('Desconto', `-${fmt(r.discount)}`)
  t.bold(true).pair('TOTAL PAGO', fmt(r.total)).bold(false)
  for (const m of r.methods.filter((m) => m.type !== 'desconto')) t.pair(`  ${PAYMENT_LABELS[m.type] ?? m.type}`, fmt(m.amount))
  if (r.change > 0) t.pair('Troco', fmt(r.change))
  t.rule().align('center').line(`Vendedor: ${extra.operator}`).line('Nao e documento fiscal').align('left')
  return t.cut().build()
}

export function testTicket(s: Settings): number[] {
  const t = new Ticket(s.paperColumns)
  t.align('center').bold(true).line('Credix PDV').bold(false).line('Teste de impressao').align('left').rule()
  t.pair('Colunas', String(s.paperColumns)).line('0123456789'.repeat(Math.ceil(s.paperColumns / 10)).slice(0, s.paperColumns))
  return t.cut().build()
}

export function cashCloseTicket(s: Settings, c: CashSession, store: StoreInfo & { terminal: string }): number[] {
  const t = new Ticket(s.paperColumns)
  header(t, store, 'FECHAMENTO DE CAIXA')
  t.line(store.terminal)
  t.line(`Aberto: ${new Date(c.opened_at).toLocaleString('pt-BR')} - ${c.opened_by ?? ''}`)
  if (c.closed_at) t.line(`Fechado: ${new Date(c.closed_at).toLocaleString('pt-BR')} - ${c.closed_by ?? ''}`)
  t.rule()
  const sum = c.summary
  t.pair('Troco inicial', fmt(sum.opening))
  for (const m of sum.methods) if (m.count > 0 || m.type === 'dinheiro') t.pair(`${m.label} (${m.count})`, fmt(m.total))
  if (sum.suprimento > 0) t.pair('Suprimentos', `+${fmt(sum.suprimento)}`)
  if (sum.sangria > 0) t.pair('Sangrias', `-${fmt(sum.sangria)}`)
  if (sum.crediario_sold > 0) t.pair('Vendido no crediario', fmt(sum.crediario_sold))
  t.rule().bold(true).pair('Dinheiro esperado', fmt(sum.expected_cash)).bold(false)
  if (c.counted_cash !== null) {
    t.pair('Dinheiro contado', fmt(c.counted_cash))
    const d = c.difference ?? 0
    t.bold(true).pair(d === 0 ? 'Caixa bateu' : d < 0 ? 'FALTA' : 'SOBRA', fmt(Math.abs(d))).bold(false)
  }
  for (const m of c.movements) {
    t.line(`${m.type === 'sangria' ? 'Sangria' : 'Suprimento'} ${new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ${m.user ?? ''}`)
    t.pair(`  ${m.reason ?? ''}`, fmt(m.amount))
  }
  if (c.notes) t.rule().wrap(`Obs.: ${c.notes}`)
  t.feed(2).line('_'.repeat(Math.min(32, s.paperColumns))).line('Assinatura')
  return t.cut().build()
}

export function movementTicket(
  s: Settings,
  m: CashMovement,
  store: StoreInfo & { terminal: string },
  openDrawer = false,
): number[] {
  const t = new Ticket(s.paperColumns)
  if (openDrawer) t.drawer()
  header(t, store, m.type === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO')
  t.line(store.terminal).line(new Date(m.created_at).toLocaleString('pt-BR'))
  t.bold(true).pair('Valor', fmt(m.amount)).bold(false)
  if (m.reason) t.wrap(`Motivo: ${m.reason}`)
  t.feed(2).line('_'.repeat(Math.min(32, s.paperColumns))).line(m.user ?? 'Assinatura')
  return t.cut().build()
}
