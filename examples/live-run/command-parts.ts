// Splits a Bash command into the parts whose output the live-run scorer can tell apart: a
// profile.ts draft, a literal echo, a cat of a file or a heredoc. A tool result holds one stream
// for the whole command, so the scorer needs to know what each part printed to pick a draft's
// lines out of it without asking the coach to mark them.
// The error only goes one way: a line is taken out of a draft's summary only when the command text
// proves another part printed it. When the splitter meets anything it does not fully understand,
// the whole command falls back to its drafts alone and every line of the result counts as a
// summary line, so a dropped line still scores. That covers an expansion or a glob, a backslash,
// a quote or heredoc that never closes, a "<<" the shell would not read as a heredoc (inside quotes,
// or a here-string), a pipe or redirect on a part that is not a draft, "||", and printf, bash -c,
// sh -c, eval or source, whose output the text does not give.
// Two more limits. Drafts side by side with nothing between their output cannot be told apart, so
// they stay one part-run. Output of other commands the text cannot give (ls and the like) is taken
// for a draft's lines.
import { posix } from 'node:path'

export type Part =
  | { kind: 'draft'; file: string }
  // Lines the part printed, known from the command text or, with `read`, from a file it reads.
  | { kind: 'known'; lines: string[]; read?: true }
  | { kind: 'other' }

export type ReadFile = (path: string) => string | undefined

const HEREDOC = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/
const MARK = '\x00'
const MARKED = new RegExp(MARK + '(\\d+)' + MARK)

type Stripped = { text: string; bodies: string[]; doubt: boolean }

// A heredoc's body is the command's input, never its shell syntax, so it is taken out before the
// command is split: a ";" inside a draft's JSON must not split anything. A heredoc starts only at
// an unquoted "<<" that is not "<<<"; any other "<<" is doubt.
// The rows after a heredoc's line, up to its closing tag.
const bodyFrom = (command: string, from: number, tag: string) => {
  const rows: string[] = []
  let pos = from
  while (pos < command.length) {
    const nl = command.indexOf('\n', pos)
    const end = nl < 0 ? command.length : nl
    const row = command.slice(pos, end)
    pos = end + 1
    if (row.trim() === tag) return { body: rows.join('\n'), next: pos, closed: true }
    rows.push(row)
  }
  return { body: rows.join('\n'), next: pos, closed: false }
}

// Where a quoted run that opens at `at` ends, and whether it is doubtful: it holds a "<<" or
// never closes.
const quoteEnd = (command: string, at: number) => {
  const quote = command[at]
  let i = at + 1
  let doubt = false
  for (; i < command.length && command[i] !== quote; i++) {
    if (quote === '"' && command[i] === '\\') i++
    else if (command.startsWith('<<', i)) doubt = true
  }
  return { next: i + 1, doubt: doubt || i >= command.length }
}

// The bodies of the heredocs a line opened, read from the next row on: where the text goes on
// and whether one never closes.
const bodiesFrom = (command: string, from: number, waiting: Waiting[], bodies: string[]) => {
  let pos = from
  let closed = true
  for (const w of waiting) {
    const got = bodyFrom(command, pos, w.tag)
    bodies[w.at] = got.body
    closed &&= got.closed
    pos = got.next
  }
  return { next: pos, closed }
}

type Waiting = { tag: string; at: number }

// "<<<" is a here-string, not a heredoc.
const heredocOpenAt = (command: string, i: number) =>
  command.startsWith('<<<', i) ? null : HEREDOC.exec(command.slice(i))

// A quoted run or an escaped character at a position, taken whole so nothing inside it can open a
// heredoc.
const literalAt = (command: string, i: number) => {
  const c = command[i]
  if (c === "'" || c === '"') return quoteEnd(command, i)
  return c === '\\' ? { next: i + 2, doubt: false } : null
}

const withoutHeredocs = (command: string): Stripped => {
  const bodies: string[] = []
  let waiting: Waiting[] = []
  let text = ''
  let doubt = false
  let i = 0
  while (i < command.length) {
    const c = command[i] ?? ''
    const lit = literalAt(command, i)
    if (lit !== null) {
      text += command.slice(i, lit.next)
      doubt ||= lit.doubt
      i = lit.next
    } else if (command.startsWith('<<', i)) {
      const m = heredocOpenAt(command, i)
      if (m === null) {
        doubt = true
        text += '<<'
        i += 2
        continue
      }
      text += MARK + bodies.length + MARK
      waiting.push({ tag: m[2] ?? '', at: bodies.push('') - 1 })
      i += m[0].length
    } else if (c === '\n' && waiting.length > 0) {
      const got = bodiesFrom(command, i + 1, waiting, bodies)
      doubt ||= !got.closed
      waiting = []
      text += c
      i = got.next
    } else {
      text += c
      i++
    }
  }
  return { text, bodies, doubt: doubt || waiting.length > 0 }
}

type Tok = {
  kind: 'word' | 'sep' | 'op' | 'space'
  value: string
  start: number
  end: number
}

const SEPARATOR = /^(?:\n|;|&&|\|\|)/

// One quoted run starting at its opening quote: its text, where the quote closes, and whether it is
// doubtful: the shell would expand something in it, a backslash in it is not one of the few the
// shell drops, or the quote never closes.
const quotedRun = (text: string, at: number) => {
  const quote = text[at] ?? ''
  let value = ''
  let i = at + 1
  let doubt = false
  for (; i < text.length && text[i] !== quote; i++) {
    const c = text[i] ?? ''
    if (quote === '"' && c === '\\' && /["\\$\x60]/.test(text[i + 1] ?? '')) i++
    else if (quote === '"' && (c === '\\' || c === '$' || c === '\x60')) doubt = true
    value += text[i] ?? ''
  }
  return { value, next: i + 1, doubt: doubt || i >= text.length }
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
    : { kind, value: sep ?? c, start: i, end: i + (sep?.length ?? 1) }
}

// A character outside quotes that the shell may expand or read in its own way.
const UNSURE = /[$\x60\\*?[{~]/

// The text a word gains at a position, where the next piece starts, and whether it is doubtful.
const pieceAt = (text: string, i: number) => {
  const c = text[i] ?? ''
  if (c === "'" || c === '"') return quotedRun(text, i)
  if (c === '\\') return { value: text[i + 1] ?? '', next: i + 2, doubt: true }
  return { value: c, next: i + 1, doubt: UNSURE.test(c) }
}

// Splits a command into words, separators (a newline, ";", "&&", "||") and the other shell
// operators. A "|" or a redirect inside quotes is part of a word.
const lex = (text: string): { toks: Tok[]; doubt: boolean } => {
  const toks: Tok[] = []
  let word: Tok | undefined
  let doubt = false
  let i = 0
  while (i < text.length) {
    const brk = breakAt(text, i)
    if (brk) {
      if (word) toks.push(word)
      word = undefined
      if (brk.kind !== 'space') toks.push(brk)
      doubt ||= brk.value === '||'
      i = brk.end
      continue
    }
    const piece = pieceAt(text, i)
    word ??= { kind: 'word', value: '', start: i, end: i }
    word.value += piece.value
    doubt ||= piece.doubt
    i = piece.next
    word.end = i
  }
  if (word) toks.push(word)
  return { toks, doubt }
}

type Segment = { raw: string; toks: Tok[] }

const segmentsOf = (text: string, all: Tok[]): Segment[] => {
  const groups: Tok[][] = [[]]
  for (const t of all) {
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
const known = (lines: string[], read?: true): Part => ({
  kind: 'known',
  lines,
  ...(read && { read }),
})

const DRAFT = /profile\.ts\s+draft\s+(\S+)/
const NO_OUTPUT_KNOWN = new Set(['printf', 'bash', 'sh', 'zsh', 'eval', 'source', '.'])

// A path as the run folder names it, so "./a", "/w/a" and "a" are one file.
const pathKey = (path: string) =>
  posix.normalize(path.replace(/^['"]|['"]$/g, '').replace(/^\/w\//, ''))

type Judged = { part: Part; doubt: boolean }

// An echo's lines. "echo -e" turns a backslash into something else, so that is doubt.
const echoPart = (args: string[]): Judged => {
  let flags = 0
  while (/^-[neE]+$/.test(args[flags] ?? '')) flags++
  const text = args.slice(flags)
  const escapes = args.slice(0, flags).some((a) => a.includes('e'))
  if (escapes && text.some((a) => a.includes('\\'))) return { part: { kind: 'other' }, doubt: true }
  return { part: known(linesOf(text.join(' '))), doubt: false }
}

const catPart = (args: string[], read: ReadFile, drafted: Set<string>): Part => {
  if (args.length === 0 || args.some((a) => a.startsWith('-'))) return { kind: 'other' }
  // A file the command drafts is read after the draft wrote it, so its text is the draft's own.
  if (args.some((a) => drafted.has(pathKey(a)))) return { kind: 'other' }
  const texts = args.map(read)
  return texts.every((t) => t !== undefined)
    ? known(linesOf(texts.join('\n')), true)
    : { kind: 'other' }
}

const partOf = (
  { raw, toks }: Segment,
  bodies: string[],
  read: ReadFile,
  drafted: Set<string>,
): Judged => {
  const marks = toks.map((t) => MARKED.exec(t.value)?.[1]).filter((m) => m !== undefined)
  const words = toks.filter((t) => t.kind === 'word' && !MARKED.test(t.value))
  const [name, ...args] = words.map((t) => t.value)
  const file = DRAFT.exec(raw)?.[1]
  const unknownOutput = NO_OUTPUT_KNOWN.has(name ?? '')
  if (file !== undefined) return { part: { kind: 'draft', file }, doubt: unknownOutput }
  const other = (doubt: boolean): Judged => ({ part: { kind: 'other' }, doubt })
  // A pipe, a redirect or a background job changes what the part prints.
  if (unknownOutput || toks.some((t) => t.kind === 'op') || marks.length > 1) return other(true)
  const body = marks.length === 1 ? bodies[Number(marks[0])] : undefined
  if (marks.length === 1)
    return name === 'cat' && args.length === 0 && body !== undefined
      ? { part: known(linesOf(body)), doubt: false }
      : other(false)
  if (name === 'echo') return echoPart(args)
  return name === 'cat' ? { part: catPart(args, read, drafted), doubt: false } : other(false)
}

export const partsOf = (command: string, read: ReadFile): Part[] => {
  const { text, bodies, doubt: heredocDoubt } = withoutHeredocs(command)
  const lexed = lex(text)
  const segments = segmentsOf(text, lexed.toks)
  const drafted = new Set(
    segments.flatMap((s) => {
      const f = DRAFT.exec(s.raw)?.[1]
      return f === undefined ? [] : [pathKey(f)]
    }),
  )
  const judged = segments.map((s) => partOf(s, bodies, read, drafted))
  const parts = judged.map((j) => j.part)
  return heredocDoubt || lexed.doubt || judged.some((j) => j.doubt)
    ? parts.filter((p) => p.kind === 'draft')
    : parts
}
