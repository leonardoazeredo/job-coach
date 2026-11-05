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

// The line a clash settles to when one side left it as it started, or both made the same change;
// undefined when the two sides changed it differently.
const settledLine = (ours: string, before: string, theirs: string): string | undefined => {
  if (ours === theirs || theirs === before) return ours
  return ours === before ? theirs : undefined
}

// Line by line where the three parts line up: a line one side left as it started takes the other
// side's line, and only a line both sides changed stays a clash. Blocks that do not line up, or
// that carry no starting lines, are left whole for the coach.
const narrowBlock = (b: Block): Part[] => {
  const start = b.start
  if (!start || b.ours.length !== start.length || b.theirs.length !== start.length) return [b]
  const out: Part[] = []
  let open: Block | undefined
  b.ours.forEach((ours, i) => {
    const before = start[i] ?? ''
    const theirs = b.theirs[i] ?? ''
    const settled = settledLine(ours, before, theirs)
    if (settled !== undefined) {
      open = undefined
      out.push(settled)
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

export const narrow = (text: string): string =>
  print(parse(text).flatMap((p) => (typeof p === 'string' ? [p] : narrowBlock(p))))

export const settle = (text: string, side: 'ours' | 'theirs'): string =>
  print(parse(text).flatMap((p) => (typeof p === 'string' ? [p] : p[side])))

export const hasClash = (text: string): boolean =>
  text.split('\n').some((l) => mark(l, '<') || mark(l, '>') || mark(l, '|') || l === '='.repeat(7))
