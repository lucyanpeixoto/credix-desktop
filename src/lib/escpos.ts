// Monta o cupom em comandos ESC/POS. O envio para a impressora fica no Rust.
// Os acentos saem sem marca (á → a): funciona em qualquer impressora térmica,
// sem depender da página de código de cada modelo.

const ESC = 0x1b
const GS = 0x1d

const plain = (s: string): string =>
  s
    .replace(/[\u00a0\u202f]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '')

export class Ticket {
  private bytes: number[] = [ESC, 0x40] // inicializa

  constructor(public readonly cols = 48) {}

  private push(...b: number[]) {
    this.bytes.push(...b)
    return this
  }

  text(s: string) {
    for (const ch of plain(s)) this.bytes.push(ch.charCodeAt(0))
    return this
  }

  line(s = '') {
    return this.text(s).push(0x0a)
  }

  align(a: 'left' | 'center' | 'right') {
    return this.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2)
  }

  bold(on: boolean) {
    return this.push(ESC, 0x45, on ? 1 : 0)
  }

  /** Letra dupla (altura e largura). */
  big(on: boolean) {
    return this.push(GS, 0x21, on ? 0x11 : 0x00)
  }

  rule(ch = '-') {
    return this.line(ch.repeat(this.cols))
  }

  /** Texto à esquerda e valor à direita na mesma linha. */
  pair(left: string, right: string) {
    const l = plain(left)
    const r = plain(right)
    const room = this.cols - r.length - 1
    if (l.length <= room) return this.line(l + ' '.repeat(this.cols - l.length - r.length) + r)
    // Não cabe: o texto vai inteiro e o valor desce alinhado à direita.
    return this.wrap(l).line(r.padStart(this.cols))
  }

  wrap(s: string) {
    const words = plain(s).split(/\s+/)
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > this.cols) {
        this.line(cur)
        cur = w
      } else cur = (cur + ' ' + w).trim()
    }
    if (cur) this.line(cur)
    return this
  }

  feed(n = 1) {
    return this.push(ESC, 0x64, n)
  }

  /** Avança o papel e corta (corte parcial). */
  cut() {
    return this.feed(4).push(GS, 0x56, 0x01)
  }

  /** Pulso no conector da gaveta (pino 2). */
  drawer() {
    return this.push(ESC, 0x70, 0x00, 0x19, 0xfa)
  }

  build(): number[] {
    return [...this.bytes]
  }
}
