// Vendas em espera: o carrinho sai do caixa (cliente no provador) e volta
// depois. Ficam no servidor (valem para todos os caixas da loja e para o
// painel); sem conexão, ficam neste computador até a próxima vez que der
// para enviar. O estoque só baixa quando a venda é finalizada.

import type { Customer } from './api'
import type { CartItem } from './cart'

export interface HeldSale {
  id: string
  /** Quando foi para a espera (ISO). */
  at: string
  /** Quem pôs em espera, só para mostrar na lista. */
  seller: string | null
  customer: Customer | null
  items: CartItem[]
  discount: number
  /** Venda das peças que ficaram de um condicional (encerra ele ao finalizar). */
  consignment?: { id: string; code: number; kind?: 'consignment' | 'reservation' } | null
  /** Guardada só neste computador (sem conexão na hora); sobe quando der. */
  local?: boolean
}

/** O corpo que o servidor guarda (POST /pdv/held-sales). */
export function heldBody(h: HeldSale) {
  return {
    customer_id: h.customer?.id ?? null,
    discount: h.discount,
    consignment_id: h.consignment?.id ?? null,
    items: h.items.map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id ?? null,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
    })),
  }
}

const KEY = 'credix-desktop.held-sales'

export function loadHeld(): HeldSale[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as HeldSale[]) : []
    return Array.isArray(list) ? list.filter((h) => Array.isArray(h?.items) && h.items.length) : []
  } catch {
    return []
  }
}

export function saveHeld(list: HeldSale[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    // Sem armazenamento: vale só enquanto o app estiver aberto.
  }
}
