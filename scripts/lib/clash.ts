// Clash blocks in a file the update could not merge: the user's lines, optionally the lines both
// sides started from, and the new version's lines, between git's seven-character markers.
// The coach talks to the user value by value, so a block is narrowed to the lines both sides
// changed, and settling one side replaces only the blocks, never the rest of the merged file.

type Block = {
  open: string
  ours: string[]
  startMark: string | undefined
  start: string[] | undefined
  theirs: string[]
  close: string
}
type Part = string | Block

const mark = (line: string, char: string) =>
  line.startsWith(char.repeat(7)) && (line.length === 7 || line[7] === ' ')

// Reads one block from its opening marker; returns it and the index of its closing marker.
const readBlock = (lines: string[], from: number): [Block, number] => {
  const block: Block = {
    open: lines[from] ?? '',
    ours: [],
    startMark: undefined,
    start: undefined,
    theirs: [],
    close: '',
  }
  let into = block.ours
  let i = from + 1
  for (; i < lines.length; i++) {
    const next = lines[i] ?? ''
    if (mark(next, '>')) {
      block.close = next
      break
    }
    if (mark(next, '|')) {
      block.startMark = next
      block.start = []
      into = block.start
    } else if (next === '='.repeat(7)) into = block.theirs
    else into.push(next)
  }
  return [block, i]
}

const parse = (text: string): Part[] => {
  const parts: Part[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (!mark(line, '<')) {
      parts.push(line)
      continue
    }
    const [block, end] = readBlock(lines, i)
    parts.push(block)
    i = end
  }
  return parts
}

const print = (parts: Part[]): string =>
  parts
    .flatMap((p) =>
      typeof p === 'string'
        ? [p]
        : [
            p.open,
            ...p.ours,
            ...(p.startMark !== undefined ? [p.startMark, ...(p.start ?? [])] : []),
            '='.repeat(7),
            ...p.theirs,
            p.close,
          ],
    )
    .join('\n')

export type SettledLine = { from: 'yours' | 'new version'; line: string }

// The line a clash settles to when one side left it as it started, or both made the same change;
// undefined when the two sides changed it differently.
const settledLine = (ours: string, before: string, theirs: string): string | undefined => {
  if (ours === theirs || theirs === before) return ours
  return ours === before ? theirs : undefined
}

// A setting written on one line, "key: value", with its indent; undefined for anything else,
// including the first line of a folded or literal paragraph, whose value runs on below it.
const keyOf = (line: string): string | undefined => line.match(/^(\s*[\w.-]+):[ \t]+[^\s>|]/)?.[1]

// Each side kept the same key on every line, so its lines can be paired by position with the
// version both started from; a moved, added or removed line breaks the pairing.
const linesUp = (side: string[], start: string[]) =>
  side.length === start.length &&
  side.every((line, i) => keyOf(line) !== undefined && keyOf(line) === keyOf(start[i] ?? ''))

// Setting by setting where the three parts line up: a setting one side left as it started takes
// the other side's value, and only a setting both sides changed stays a clash. Anything else,
// such as prose, whose neighbouring lines depend on each other, is left whole for the coach.
const narrowBlock = (b: Block, settled: SettledLine[]): Part[] => {
  const start = b.start
  if (!start || !linesUp(b.ours, start) || !linesUp(b.theirs, start)) return [b]
  const out: Part[] = []
  let open: Block | undefined
  b.ours.forEach((ours, i) => {
    const before = start[i] ?? ''
    const theirs = b.theirs[i] ?? ''
    const line = settledLine(ours, before, theirs)
    if (line !== undefined) {
      open = undefined
      out.push(line)
      // A line both sides changed the same way was never a choice, so it is not reported.
      if (ours !== theirs) settled.push({ from: line === ours ? 'yours' : 'new version', line })
      return
    }
    if (!open) {
      open = { ...b, ours: [], start: [], theirs: [] }
      out.push(open)
    }
    open.ours.push(ours)
    open.start?.push(before)
    open.theirs.push(theirs)
  })
  return out
}

// The narrowed text, and each line settled from one side, for the coach to tell the user.
// lineByLine is off for a file that is not settings, where a line that reads "Note: x" is prose.
export const narrow = (
  text: string,
  { lineByLine = true }: { lineByLine?: boolean } = {},
): { text: string; settled: SettledLine[] } => {
  const settled: SettledLine[] = []
  const parts = parse(text).flatMap((p) =>
    typeof p === 'string' || !lineByLine ? [p] : narrowBlock(p, settled),
  )
  return { text: print(parts), settled }
}

export const settle = (text: string, side: 'ours' | 'theirs'): string =>
  print(parse(text).flatMap((p) => (typeof p === 'string' ? [p] : p[side])))

export const hasClash = (text: string): boolean =>
  text.split('\n').some((l) => mark(l, '<') || mark(l, '>') || mark(l, '|') || l === '='.repeat(7))
