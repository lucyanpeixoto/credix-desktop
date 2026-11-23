import { describe, expect, it } from 'vitest'
import { outsideLabel, type Customer } from '../api'
import { heldBody, type HeldSale } from '../held'

describe('venda em espera', () => {
  it('manda ao servidor o carrinho com o avulso e a cobrança do condicional', () => {
    const h: HeldSale = {
      id: 'h1',
      at: '2026-11-23T10:00:00Z',
      seller: 'Ana',
      customer: { id: 'c1', name: 'Carla' } as Customer,
      discount: 10,
      consignment: { id: 'k1', code: 4 },
      items: [
        { key: 'a', product_id: 'p1', variant_id: 'v1', name: 'Polo', sku: '000888', unit_price: 80, quantity: 2 },
        { key: 'b', product_id: null, name: 'Ajuste de barra', sku: null, unit_price: 15, quantity: 1 },
      ],
    }
    expect(heldBody(h)).toEqual({
      customer_id: 'c1',
      discount: 10,
      consignment_id: 'k1',
      items: [
        { product_id: 'p1', variant_id: 'v1', name: 'Polo', quantity: 2, unit_price: 80 },
        { product_id: null, variant_id: null, name: 'Ajuste de barra', quantity: 1, unit_price: 15 },
      ],
    })
  })
})

describe('peças com cliente', () => {
  it('explica o sem estoque', () => {
    expect(outsideLabel({ reservation: 1, consignment: 0 })).toBe('1 reservada')
    expect(outsideLabel({ reservation: 2, consignment: 3 })).toBe('2 reservadas · 3 em condicional')
    expect(outsideLabel({ reservation: 0, consignment: 0 })).toBe('')
    expect(outsideLabel(null)).toBe('')
  })
})
