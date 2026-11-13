// Pilha dos modais abertos: atalhos de teclado valem só para o de cima,
// e as telas de fundo sabem que não devem reagir enquanto houver modal.
const stack: symbol[] = []

export const modalStack = {
  /** Registra o modal e devolve a função que o tira da pilha. */
  push(id: symbol): () => void {
    stack.push(id)
    return () => {
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
    }
  },
  isTop: (id: symbol): boolean => stack[stack.length - 1] === id,
  get open(): boolean {
    return stack.length > 0
  },
}
