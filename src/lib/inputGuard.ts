// Bloqueia letras nos campos de número e de dinheiro do app inteiro, ao
// digitar e ao colar. Vale pelo tipo do campo, sem marcar campo por campo:
// - inputmode="decimal"  → dinheiro: dígitos, ponto e uma vírgula
// - type="number"        → inteiro: só dígitos (o WebKit do macOS aceita letras)
// - inputmode="numeric"  → documento (CPF): dígitos, ponto, traço e barra
// - inputmode="tel"      → telefone: dígitos, espaço, parênteses, traço e +

type Kind = 'money' | 'int' | 'doc' | 'tel'

const ALLOWED: Record<Kind, RegExp> = {
  money: /[0-9.,]/,
  int: /[0-9]/,
  doc: /[0-9./-]/,
  tel: /[0-9 ()+-]/,
}

function kindOf(el: EventTarget | null): Kind | null {
  if (!(el instanceof HTMLInputElement)) return null
  if (el.type === 'number') return 'int'
  const mode = el.getAttribute('inputmode')
  if (mode === 'decimal') return 'money'
  if (mode === 'numeric') return 'doc'
  if (mode === 'tel') return 'tel'
  return null
}

/** Texto colado só com o que o campo aceita (dinheiro: no máximo uma vírgula). */
function clean(kind: Kind, text: string): string {
  let out = [...text].filter((c) => ALLOWED[kind].test(c)).join('')
  if (kind === 'money') {
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
  // Dinheiro: uma vírgula só (fora do trecho selecionado, que será trocado).
  if (kind === 'money' && e.key === ',' && el.type !== 'number') {
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

export function installInputGuard() {
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('paste', onPaste, true)
}
