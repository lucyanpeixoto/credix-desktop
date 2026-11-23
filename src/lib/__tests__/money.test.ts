import { describe, expect, it } from 'vitest'
import { dueDateIso, parseMoney, round2, toInput } from '../money'

describe('dinheiro', () => {
  it('lê os jeitos que o caixa digita', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56)
    expect(parseMoney('1234,5')).toBe(1234.5)
    expect(parseMoney('R$ 10,00')).toBe(10)
    expect(parseMoney('12.50')).toBe(12.5)
    expect(parseMoney('abc')).toBe(0)
    expect(parseMoney('')).toBe(0)
  })

  it('arredonda centavos sem o erro do ponto flutuante', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
    expect(toInput(12.5)).toBe('12,50')
    expect(toInput(0)).toBe('')
  })
})

describe('vencimento do crediário (mesma regra do servidor)', () => {
  it('mensal não passa do fim do mês', () => {
    expect(dueDateIso('2026-01-31', 30, 1)).toBe('2026-02-28')
    expect(dueDateIso('2026-01-31', 30, 2)).toBe('2026-03-31')
  })

  it('semanal e quinzenal contam em dias', () => {
    expect(dueDateIso('2026-11-23', 7, 1)).toBe('2026-11-30')
    expect(dueDateIso('2026-11-23', 15, 2)).toBe('2026-12-23')
  })
})
