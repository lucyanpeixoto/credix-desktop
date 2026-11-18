const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmt = (v: number | null | undefined): string => brl.format(v ?? 0)

/** Arredonda para centavos sem os erros de ponto flutuante (0,1 + 0,2). */
export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100

/** Lê "1.234,56", "1234,56" ou "1234.56". Vazio ou inválido vira 0. */
export function parseMoney(input: string | number | null | undefined): number {
  if (typeof input === 'number') return round2(input)
  if (!input) return 0
  let s = String(input).trim().replace(/[R$\s]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? round2(n) : 0
}

/** Valor para preencher um campo de texto: 12,50. */
export const toInput = (v: number): string => (v ? v.toFixed(2).replace('.', ',') : '')

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function todayIso(): string {
  return toIso(new Date())
}

/**
 * Vencimento da n-ésima parcela, com a regra do servidor (Installment::dueDateFor):
 * intervalo múltiplo de 30 conta em meses, sem passar do fim do mês (31/01 → 28/02).
 */
export function dueDateIso(startIso: string, intervalDays: number, n: number): string {
  const [y, m, d] = startIso.slice(0, 10).split('-').map(Number)
  if (intervalDays % 30 !== 0) return toIso(new Date(y, m - 1, d + intervalDays * n))
  const month = new Date(y, m - 1 + (intervalDays / 30) * n, 1)
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return toIso(new Date(month.getFullYear(), month.getMonth(), Math.min(d, lastDay)))
}

export const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  pix_online: 'Pix (QR)',
  debito: 'Débito',
  credito: 'Crédito',
  crediario: 'Crediário',
  misto: 'Misto',
  vale_troca: 'Vale-troca',
  ajuste: 'Ajuste',
  desconto: 'Desconto',
}
