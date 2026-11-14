// Bloqueia letras nos campos de número e de dinheiro do app inteiro, ao
// digitar, ao colar e no que chegar por acento ou autocompletar. Vale pelo
// tipo do campo, sem marcar campo por campo:
// - inputmode="decimal"  → dinheiro, com máscara de caixa registradora: só
//   dígitos, que entram pelos centavos (9990 → 99,90; 123456 → 1.234,56).
//   Percentual com o mesmo inputmode leva data-mask="off": dígitos, ponto
//   e uma vírgula.
// - type="number"        → inteiro: só dígitos (o WebKit do macOS aceita letras)
// - inputmode="numeric"  → documento (CPF): dígitos, ponto, traço e barra
// - inputmode="tel"      → telefone: dígitos, espaço, parênteses, traço e +

type Kind = 'money' | 'percent' | 'int' | 'doc' | 'tel'

const ALLOWED: Record<Kind, RegExp> = {
  money: /[0-9.,]/,
  percent: /[0-9.,]/,
  int: /[0-9]/,
  doc: /[0-9./-]/,
  tel: /[0-9 ()+-]/,
}

function kindOf(el: EventTarget | null): Kind | null {
  if (!(el instanceof HTMLInputElement)) return null
  if (el.type === 'number') return 'int'
  const mode = el.getAttribute('inputmode')
  if (mode === 'decimal') return el.dataset.mask === 'off' ? 'percent' : 'money'
  if (mode === 'numeric') return 'doc'
  if (mode === 'tel') return 'tel'
  return null
}

const MAX_DIGITS = 11 // até 999.999.999,99

/** Dígitos → "1.234,56" (centavos à direita); sem dígitos, vazio. */
export function formatCents(digits: string): string {
  const d = digits.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS)
  if (!d) return ''
  const n = d.padStart(3, '0')
  return n.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + n.slice(-2)
}

/** Texto colado como número de verdade ("99,9" → 99,90; "1.234,5" → 1.234,50). */
function pastedCents(text: string): string {
  let s = text.replace(/[^0-9,.]/g, '')
  s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(s)
  return Number.isFinite(n) && s !== '' ? formatCents(String(Math.round(n * 100))) : ''
}

/** Texto colado só com o que o campo aceita (percentual: no máximo uma vírgula). */
function clean(kind: Kind, text: string): string {
  let out = [...text].filter((c) => ALLOWED[kind].test(c)).join('')
  if (kind === 'percent') {
    const i = out.indexOf(',')
    if (i >= 0) out = out.slice(0, i + 1) + out.slice(i + 1).replace(/,/g, '')
  }
  return out
}

function onKeydown(e: KeyboardEvent) {
  const kind = kindOf(e.target)
  if (!kind || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
  const el = e.target as HTMLInputElement
  if (!ALLOWED[kind].test(e.key)) {
    e.preventDefault()
    return
  }
  // Percentual: uma vírgula só (fora do trecho selecionado, que será trocado).
  if (kind === 'percent' && e.key === ',') {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    if ((el.value.slice(0, start) + el.value.slice(end)).includes(',')) e.preventDefault()
  }
}

function onPaste(e: ClipboardEvent) {
  const kind = kindOf(e.target)
  if (!kind) return
  const el = e.target as HTMLInputElement
  const text = e.clipboardData?.getData('text') ?? ''
  if (kind === 'money') {
    e.preventDefault()
    el.value = pastedCents(text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  const cleaned = clean(kind, text)
  if (cleaned === text) return
  e.preventDefault()
  if (!cleaned) return
  if (el.type === 'number') {
    el.value = cleaned
  } else {
    el.setRangeText(cleaned, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end')
  }
  // Avisa o Svelte (bind:value) que o valor mudou.
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

// Formata o dinheiro e limpa os demais antes do Svelte ler o valor (fase de
// captura). Pega também letra com acento, autocompletar e arrastar.
function onInput(e: Event) {
  const kind = kindOf(e.target)
  const el = e.target as HTMLInputElement
  if (!kind || el.type === 'number') return
  if (kind === 'money') {
    const formatted = formatCents(el.value)
    if (formatted !== el.value) el.value = formatted
    el.setSelectionRange(el.value.length, el.value.length)
    return
  }
  const cleaned = clean(kind, el.value)
  if (cleaned === el.value) return
  const caret = Math.max(0, (el.selectionStart ?? el.value.length) - (el.value.length - cleaned.length))
  el.value = cleaned
  el.setSelectionRange(caret, caret)
}

export function installInputGuard() {
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('paste', onPaste, true)
  document.addEventListener('input', onInput, true)
}
