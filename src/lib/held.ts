// Vendas em espera: o carrinho sai do caixa (cliente no provador) e volta
// depois. Ficam gravadas no próprio computador e sobrevivem a fechar o app.
// Nada vai para o servidor: o estoque só baixa quando a venda é finalizada.

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
}

const KEY = 'credix-desktop.held-sales'
/** Um limite para a lista não virar depósito de carrinhos esquecidos. */
export const MAX_HELD = 10

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
