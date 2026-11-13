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

export function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  pix_online: 'Pix (QR)',
  debito: 'Débito',
  credito: 'Crédito',
  crediario: 'Crediário',
  ajuste: 'Ajuste',
  desconto: 'Desconto',
}
