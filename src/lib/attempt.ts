/**
 * Chave de idempotência de uma operação do caixa (venda, recebimento,
 * sangria...). Repetir o MESMO pedido reaproveita a chave, então o Credix
 * devolve o que já gravou em vez de gravar de novo. Se o pedido mudar
 * (outra forma de pagamento, outro valor), a chave é trocada.
 */
export class Attempt {
  private key = crypto.randomUUID()
  private body: string | null = null

  keyFor(body: unknown): string {
    const s = JSON.stringify(body)
    if (this.body !== null && this.body !== s) this.key = crypto.randomUUID()
    this.body = s
    return this.key
  }

  /** Operação concluída: a próxima é outra. */
  reset() {
    this.key = crypto.randomUUID()
    this.body = null
  }
}
