import { describe, expect, it } from 'vitest'
import type { Product, ProductVariant, Sale } from '../api'
import { cashDueOf, fromProduct, parseQuantityPrefix, splitInstallments, subtotalOf } from '../cart'

const camisa = { id: 'p1', name: 'Camisa', sku: '000023', price: 89.9, stock: 3, active: true, code: null } as Product

describe('carrinho', () => {
  it('quantidade antes do código: 3*código ou 3x código', () => {
    expect(parseQuantityPrefix('3*000023')).toEqual({ quantity: 3, term: '000023' })
    expect(parseQuantityPrefix('2x 000023-1')).toEqual({ quantity: 2, term: '000023-1' })
    expect(parseQuantityPrefix(' 000023 ')).toEqual({ quantity: 1, term: '000023' })
    expect(parseQuantityPrefix('0*000023').quantity).toBe(1)
  })

  it('produto com variação leva o estoque e o rótulo dela', () => {
    const p = { id: 'v1', label: 'P / Azul', stock: 1, size: 'P', color: 'Azul' } as ProductVariant
    expect(fromProduct(camisa, 2, p)).toMatchObject({ product_id: 'p1', variant_id: 'v1', variant_label: 'P / Azul', quantity: 2, stock: 1 })
    expect(fromProduct(camisa)).toMatchObject({ variant_id: null, stock: 3 })
  })

  it('subtotal soma em centavos', () => {
    expect(subtotalOf([fromProduct(camisa, 3), { ...fromProduct(camisa), unit_price: 0.1 }])).toBe(269.8)
  })

  it('parcelas iguais e o resto na última, como o servidor', () => {
    expect(splitInstallments(100, 3)).toEqual([33.33, 33.33, 33.34])
    expect(splitInstallments(0, 3)).toEqual([])
    expect(splitInstallments(100, 0)).toEqual([])
  })

  it('troco só sobre o que foi pago em dinheiro', () => {
    expect(cashDueOf({ payment_type: 'dinheiro', total: 100, credit_used: 30 } as Sale)).toBe(70)
    expect(
      cashDueOf({
        payment_type: 'misto',
        total: 100,
        payment_methods: [
          { payment_type: 'dinheiro', amount: 40 },
          { payment_type: 'pix', amount: 60 },
        ],
      } as unknown as Sale),
    ).toBe(40)
  })
})
