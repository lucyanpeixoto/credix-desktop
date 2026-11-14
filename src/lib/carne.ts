// Carnê da LX-300 (formulário contínuo pré-impresso, 215 × 76,5 mm) em ESC/P,
// a linguagem das matriciais Epson. Vai direto para a impressora (RAW), sem
// janela de impressão nem formulário criado no Windows.
//
// Layout e campos vêm do Credix (os mesmos do carnê calibrado do painel), em
// twips (1/1440 pol). Cada campo é posicionado de forma absoluta:
// - horizontal com ESC $ em 1/60 pol;
// - vertical com ESC J em 1/216 pol, contando a posição desde o topo do
//   primeiro formulário. Cada folha começa exatamente 76,5 mm depois da
//   anterior, sem acumular erro.
// Letra 12 cpi (cabe mais do nome que no 10 cpi); acentos saem sem marca,
// como no cupom.

import { plain } from './escpos'

export type Align = 'left' | 'right' | 'center'
export type CarneField = [x: number, y: number, width: number, align: Align]

export interface CarneData {
  sale_code: string | null
  page: { width_mm: number; height_mm: number }
  line_twips: number
  layout: Record<string, Record<string, CarneField>>
  sample: Record<string, string>
  sheets: { id: string; numero: number; total: number; campos: Record<string, string> }[]
}

/** Ajuste fino salvo no computador do caixa (mm; + vai para a direita / para baixo). */
export interface CarneAdjust {
  dx: number
  dy: number
  bold: boolean
}

const ESC = 0x1b
const CR = 0x0d
const TWIPS_PER_CHAR = 120 // 12 cpi
const TWIPS_PER_H = 24 // 1/60 pol
const TWIPS_PER_V = 1440 / 216 // 1/216 pol
/** O texto de 10 pt do layout fica centralizado na linha; a cabeça imprime a partir do topo. */
const TOP_OFFSET = 40
const mmToTwips = (mm: number) => (mm / 25.4) * 1440

interface Item {
  y: number
  x: number
  text: string
}

/** Quebra em até `lines` linhas de `max` caracteres, por palavra. */
function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= max) cur = next
    else {
      if (cur) out.push(cur)
      cur = word.slice(0, max)
    }
  }
  if (cur) out.push(cur)
  return out.slice(0, lines)
}

/** Campos de uma folha já com texto, posição de início e linha. */
function items(data: CarneData, campos: Record<string, string>, adj: CarneAdjust): Item[] {
  const dx = mmToTwips(adj.dx)
  const list: Item[] = []
  for (const via of Object.values(data.layout)) {
    for (const [key, [x, y, w, align]] of Object.entries(via)) {
      const max = Math.floor(w / TWIPS_PER_CHAR)
      const value = plain(campos[key] ?? '').trim()
      if (!value) continue
      // Endereço em até 2 linhas, como no legado (rua… / cidade, UF). Os outros
      // campos vão inteiros; o corte, se precisar, é no campo seguinte da linha.
      const lines = key === 'endereco' ? wrap(value, max, 2) : [value]
      lines.forEach((text, i) => {
        const width = text.length * TWIPS_PER_CHAR
        const start = align === 'right' ? x + w - width : align === 'center' ? x + (w - width) / 2 : x
        list.push({ y: y + i * data.line_twips, x: Math.max(0, start + dx), text })
      })
    }
  }
  return list
}

export class CarneJob {
  private bytes: number[] = []
  /** Posição vertical atual, em 1/216 pol desde o topo do primeiro formulário. */
  private v = 0
  private sheets = 0

  constructor(
    private data: CarneData,
    private adj: CarneAdjust,
  ) {
    // Inicializa, 12 cpi, qualidade rascunho (mais rápida), sem pular a picotagem.
    this.push(ESC, 0x40, ESC, 0x4d, ESC, 0x78, 0, ESC, 0x4f)
    if (adj.bold) this.push(ESC, 0x45)
  }

  private push(...b: number[]) {
    this.bytes.push(...b)
  }

  private feedTo(target: number) {
    let n = Math.round(target) - this.v
    while (n > 0) {
      const step = Math.min(n, 255)
      this.push(ESC, 0x4a, step)
      n -= step
      this.v += step
    }
  }

  /** Uma folha (as duas vias) com os campos informados. */
  sheet(campos: Record<string, string>, extra: Item[] = []) {
    const top = (this.sheets * this.data.page.height_mm * 216) / 25.4
    const dy = mmToTwips(this.adj.dy)
    const all = [...items(this.data, campos, this.adj), ...extra].sort((a, b) => a.y - b.y || a.x - b.x)

    // Campos com até 1/24 pol de diferença saem na mesma passada da cabeça.
    const rows: Item[][] = []
    for (const it of all) {
      const row = rows.at(-1)
      if (row && it.y - row[0].y <= 60) row.push(it)
      else rows.push([it])
    }

    for (const row of rows) {
      this.feedTo(top + Math.max(0, row[0].y + TOP_OFFSET + dy) / TWIPS_PER_V)
      this.push(CR)
      const pageEnd = mmToTwips(this.data.page.width_mm)
      let used = 0 // até onde a linha já foi escrita, em 1/60 pol
      row.sort((a, b) => a.x - b.x).forEach((it, i) => {
        // Como no legado, o texto pode passar da caixa (a letra da matricial é
        // mais larga que o Arial do modelo), mas para uma letra antes do
        // próximo campo da mesma linha e da borda do formulário.
        const limit = Math.min(row[i + 1]?.x ?? pageEnd, pageEnd)
        const room = Math.max(1, Math.floor((limit - it.x) / TWIPS_PER_CHAR) - 1)
        const text = it.text.slice(0, room)
        const pos = Math.max(used, Math.round(it.x / TWIPS_PER_H))
        this.push(ESC, 0x24, pos & 0xff, pos >> 8)
        for (const ch of text) this.push(ch.charCodeAt(0))
        used = pos + Math.ceil((text.length * TWIPS_PER_CHAR) / TWIPS_PER_H)
      })
      this.push(CR)
    }
    this.sheets++
    return this
  }

  /** Termina no topo do próximo formulário: a próxima impressão já começa alinhada. */
  done(): number[] {
    this.feedTo((this.sheets * this.data.page.height_mm * 216) / 25.4)
    if (this.adj.bold) this.push(ESC, 0x46)
    return this.bytes
  }
}

/** Carnê com as folhas da venda (uma por parcela em aberto). */
export function carneBytes(data: CarneData, adj: CarneAdjust): number[] {
  const job = new CarneJob(data, adj)
  for (const s of data.sheets) job.sheet(s.campos)
  return job.done()
}

/** Página de teste: dados de exemplo, cruzes nos cantos e o aviso no meio. */
export function carneTestBytes(data: CarneData, adj: CarneAdjust): number[] {
  const h = mmToTwips(data.page.height_mm)
  const w = mmToTwips(data.page.width_mm)
  const dx = mmToTwips(adj.dx)
  const mark = (x: number, y: number): Item => ({ x: Math.max(0, x + dx), y, text: '+' })
  return new CarneJob(data, adj)
    .sheet(data.sample, [
      mark(240, 0),
      mark(w - 900, 0),
      mark(240, h - 480),
      mark(w - 900, h - 480),
      { x: mmToTwips(70) + dx, y: mmToTwips(52), text: 'TESTE DE ALINHAMENTO' },
    ])
    .done()
}
