import type { Product, ProductVariant } from './api'
import { round2 } from './money'

export interface CartItem {
  key: string
  product_id: string | null
  variant_id?: string | null
  variant_label?: string | null
  name: string
  sku: string | null
  unit_price: number
  quantity: number
}

let n = 0
export const newKey = (): string => `i${Date.now().toString(36)}${(n++).toString(36)}`

export function fromProduct(p: Product, quantity = 1, variant: ProductVariant | null = null): CartItem {
  return {
    key: newKey(),
    product_id: p.id,
    variant_id: variant?.id ?? null,
    variant_label: variant?.label ?? null,
    name: p.name,
    sku: p.sku,
    unit_price: p.price,
    quantity,
  }
}

export const subtotalOf = (items: CartItem[]): number =>
  round2(items.reduce((s, i) => s + round2(i.unit_price * i.quantity), 0))

/** Divide o financiado como o servidor: parcelas iguais e o resto na última. */
export function splitInstallments(financed: number, count: number): number[] {
  if (count < 1 || financed <= 0) return []
  const base = round2(financed / count)
  const out: number[] = []
  let used = 0
  for (let i = 1; i <= count; i++) {
    const v = i === count ? round2(financed - used) : base
    used = round2(used + v)
    out.push(v)
  }
  return out
}

/** "3*7891234" → 3 unidades do código 7891234. */
export function parseQuantityPrefix(input: string): { quantity: number; term: string } {
  const m = input.trim().match(/^(\d{1,4})\s*[*xX]\s*(.+)$/)
  if (m) return { quantity: Math.max(1, Number(m[1])), term: m[2].trim() }
  return { quantity: 1, term: input.trim() }
}
