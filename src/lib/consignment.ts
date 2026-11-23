// Regras do acerto do condicional/reserva, fora do componente para dar para testar.
import type { ConsignmentItem } from './api'

/** Uma linha por peça: o cliente levou 2 iguais, aparecem 2; as primeiras são as que voltaram. */
export function piecesOf(items: ConsignmentItem[], kept: Record<number, number>) {
  return items.flatMap((i) => Array.from({ length: i.quantity }, (_, n) => ({ item: i, n, back: n < i.quantity - (kept[i.id] ?? 0) })))
}

export type ScanResult = { kind: 'ask'; options: ConsignmentItem[] } | { kind: 'none' } | { kind: 'all-back' }

/**
 * O código lido no acerto: o da etiqueta da variação (000023-2) ou o SKU do
 * produto (que casa com todos os tamanhos dele). Só oferece peças que ainda
 * contam como "ficou".
 */
export function matchScan(items: ConsignmentItem[], kept: Record<number, number>, raw: string): ScanResult {
  const code = raw.trim().toUpperCase()
  const hit = items.filter((i) => i.code?.toUpperCase() === code || i.sku?.toUpperCase() === code)
  if (!code || !hit.length) return { kind: 'none' }
  const open = hit.filter((i) => (kept[i.id] ?? 0) > 0)
  return open.length ? { kind: 'ask', options: open } : { kind: 'all-back' }
}
