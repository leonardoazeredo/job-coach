// Splits a Bash command into the parts whose output the live-run scorer can tell apart: a
// profile.ts draft, a literal echo, a cat of a file or a heredoc. A tool result holds one stream
// for the whole command, so the scorer needs to know what each part would have printed to pick a
// draft's lines out of it without asking the coach to mark them.
export type Part =
  | { kind: 'draft'; file: string }
  // Lines the part printed, known from the command text or from a file it reads.
  | { kind: 'known'; lines: string[] }
  | { kind: 'other' }

export type ReadFile = (path: string) => string | undefined

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/
const MARK = '\x00'
const MARKED = new RegExp(MARK + '(\\d+)' + MARK)

// A heredoc's body is the command's input, never its shell syntax, so it is taken out before the
// command is split: a ";" inside a draft's JSON must not split anything.
const withoutHeredocs = (command: string): { text: string; bodies: string[] } => {
  const bodies: string[] = []
  const kept: string[] = []
  const rows = command.split('\n')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? ''
    const tag = HEREDOC.exec(row)?.[2]
    if (tag === undefined) {
      kept.push(row)
      continue
    }
    const body: string[] = []
    while (i + 1 < rows.length && (rows[i + 1] ?? '').trim() !== tag) body.push(rows[++i] ?? '')
    i++
    kept.push(row.replace(HEREDOC, MARK + bodies.length + MARK))
    bodies.push(body.join('\n'))
  }
  return { text: kept.join('\n'), bodies }
}

type Tok = {
  kind: 'word' | 'sep' | 'op' | 'space'
  value: string
  start: number
  end: number
  bad: boolean
}

const SEPARATOR = /^(?:\n|;|&&|\|\|)/

// One quoted run starting at its opening quote: its text, where the quote closes, and whether the
// shell would expand something in it or the quote never closes.
const quotedRun = (text: string, at: number) => {
  const quote = text[at] ?? ''
  let value = ''
  let i = at + 1
  let bad = false
  for (; i < text.length && text[i] !== quote; i++) {
    if (text[i] === '\\' && quote === '"') i++
    else if (quote === '"' && (text[i] === '$' || text[i] === '\x60')) bad = true
    value += text[i] ?? ''
  }
  return { value, next: i + 1, bad: bad || i >= text.length }
}

const KINDS = [
  ['sep', SEPARATOR],
  ['space', /^\s$/],
  ['op', /^[<>|&]$/],
] as const

// The separator, operator or whitespace character at a position, or undefined for a word character.
const breakAt = (text: string, i: number): Tok | undefined => {
  const c = text[i] ?? ''
  const sep = SEPARATOR.exec(text.slice(i))?.[0]
  const kind = KINDS.find(([, re]) => re.test(sep ?? c))?.[0]
  return kind === undefined
    ? undefined
    : { kind, value: sep ?? c, start: i, end: i + (sep?.length ?? 1), bad: false }
}

// The text a word gains at a position, where the next piece starts, and whether the shell would
// expand it.
const pieceAt = (text: string, i: number) => {
  const c = text[i] ?? ''
  if (c === "'" || c === '"') return quotedRun(text, i)
  if (c === '\\') return { value: text[i + 1] ?? '', next: i + 2, bad: false }
  return { value: c, next: i + 1, bad: c === '$' || c === '\x60' }
}

// Splits a command into words, separators (a newline, ";", "&&", "||") and the other shell
// operators. A "|" or a redirect inside quotes is part of a word, and a word the shell would
// expand is marked, because what it prints cannot be known from the text.
const lex = (text: string): Tok[] => {
  const toks: Tok[] = []
  let word: Tok | undefined
  let i = 0
  while (i < text.length) {
    const brk = breakAt(text, i)
    if (brk) {
      if (word) toks.push(word)
      word = undefined
      if (brk.kind !== 'space') toks.push(brk)
      i = brk.end
      continue
    }
    const piece = pieceAt(text, i)
    word ??= { kind: 'word', value: '', start: i, end: i, bad: false }
    word.value += piece.value
    word.bad ||= piece.bad
    i = piece.next
    word.end = i
  }
  if (word) toks.push(word)
  return toks
}

type Segment = { raw: string; toks: Tok[] }

const segmentsOf = (text: string): Segment[] => {
  const groups: Tok[][] = [[]]
  for (const t of lex(text)) {
    if (t.kind === 'sep') groups.push([])
    else groups.at(-1)?.push(t)
  }
  return groups
    .filter((g) => g.length > 0)
    .map((toks) => ({
      raw: text.slice(toks[0]?.start, toks.at(-1)?.end),
      toks,
    }))
}

const linesOf = (text: string): string[] => text.split('\n').filter((l) => l.trim() !== '')
const known = (lines: string[]): Part => ({ kind: 'known', lines })

const partOf = ({ raw, toks }: Segment, bodies: string[], read: ReadFile): Part => {
  const drafted = /profile\.ts\s+draft\s+(\S+)/.exec(raw)?.[1]
  if (drafted !== undefined) return { kind: 'draft', file: drafted }
  const marked = toks.map((t) => MARKED.exec(t.value)?.[1]).find((m) => m !== undefined)
  const body = marked === undefined ? undefined : bodies[Number(marked)]
  const words = toks.filter((t) => t.kind === 'word' && !MARKED.test(t.value))
  if (toks.some((t) => t.bad || t.kind === 'op')) return { kind: 'other' }
  const [name, ...args] = words.map((t) => t.value)
  if (body !== undefined)
    return name === 'cat' && args.length === 0 ? known(linesOf(body)) : { kind: 'other' }
  if (name === 'echo')
    return known(linesOf(args.filter((a, i) => i > 0 || !/^-[neE]+$/.test(a)).join(' ')))
  if (name !== 'cat' || args.length === 0 || args.some((a) => a.startsWith('-')))
    return { kind: 'other' }
  const texts = args.map(read)
  return texts.every((t) => t !== undefined) ? known(linesOf(texts.join('\n'))) : { kind: 'other' }
}

export const partsOf = (command: string, read: ReadFile): Part[] => {
  const { text, bodies } = withoutHeredocs(command)
  return segmentsOf(text).map((s) => partOf(s, bodies, read))
}
