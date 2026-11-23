import { describe, expect, it } from 'vitest'
import type { ConsignmentItem } from '../api'
import { matchScan, piecesOf } from '../consignment'

const item = (id: number, code: string | null, sku: string, quantity = 1): ConsignmentItem =>
  ({ id, code, sku, quantity, name: `Peça ${id}`, product_id: 'p', product_variant_id: null, variant_label: null, unit_price: 50 }) as ConsignmentItem

const camisas = item(1, '000777', '000777', 2)
const poloP = item(2, '000888-1', '000888')
const poloG = item(3, '000888-2', '000888')
const items = [camisas, poloP, poloG]

describe('acerto do condicional', () => {
  it('uma linha por peça, as devolvidas primeiro', () => {
    const pieces = piecesOf(items, { 1: 1, 2: 1, 3: 1 })
    expect(pieces).toHaveLength(4)
    expect(pieces.filter((p) => p.item.id === 1).map((p) => p.back)).toEqual([true, false])
  })

  it('o código da variação acha a peça certa', () => {
    expect(matchScan(items, { 1: 2, 2: 1, 3: 1 }, '000888-2')).toEqual({ kind: 'ask', options: [poloG] })
    expect(matchScan(items, { 1: 2, 2: 1, 3: 1 }, ' 000777 ')).toEqual({ kind: 'ask', options: [camisas] })
  })

  it('o SKU de produto com grade pergunta qual tamanho voltou', () => {
    expect(matchScan(items, { 1: 2, 2: 1, 3: 1 }, '000888')).toEqual({ kind: 'ask', options: [poloP, poloG] })
    // A P já voltou: só a G é opção.
    expect(matchScan(items, { 1: 2, 2: 0, 3: 1 }, '000888')).toEqual({ kind: 'ask', options: [poloG] })
  })

  it('avisa quando não é deste condicional ou já voltou tudo', () => {
    expect(matchScan(items, { 1: 2, 2: 1, 3: 1 }, '999999')).toEqual({ kind: 'none' })
    expect(matchScan(items, { 1: 2, 2: 0, 3: 1 }, '000888-1')).toEqual({ kind: 'all-back' })
    expect(matchScan(items, {}, '')).toEqual({ kind: 'none' })
  })
})
