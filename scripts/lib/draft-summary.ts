// The summary of a Draft, rendered from the same value that is written: every shown value of a
// new file, or only what changes in an existing one. Scalars render as their label and value,
// list items through their table's frame, ISO dates in the user's locale; the rest verbatim.
import type { EntriesField, Field, GroupField, ItemsField, Shape } from './draft-fields.ts'
import { entryGroup, fieldIn, idOf, isObj, itemGroup, type Obj } from './draft-merge.ts'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type Render = { locale: string }

const MONTH = /^(\d{4})-(\d{2})$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const dateIn = (text: string, { locale }: Render): string => {
  if (text === 'present') return 'now'
  const month = MONTH.exec(text)
  const day = DAY.exec(text)
  const opts: Intl.DateTimeFormatOptions = day
    ? { dateStyle: 'long', timeZone: 'UTC' }
    : { month: 'long', year: 'numeric', timeZone: 'UTC' }
  const parts = (day ?? month)?.slice(1).map(Number)
  if (!parts) return text
  const [y = 0, m = 1, d = 1] = parts
  return new Intl.DateTimeFormat(locale, opts).format(Date.UTC(y, m - 1, d))
}

const shown = (v: unknown, field: Field | undefined, r: Render): string => {
  if (Array.isArray(v)) return v.map((x) => shown(x, undefined, r)).join(', ')
  const standIn = field?.t === 'value' ? field.standIn : undefined
  if (standIn && standIn.text === v) return standIn.says
  if (typeof v === 'string' && field?.t === 'value' && field.date) return dateIn(v, r)
  return isObj(v) ? JSON.stringify(v) : String(v)
}

const fieldAt = (shape: Shape, path: string[]): Field | undefined => {
  const [head, ...rest] = path
  if (head === undefined) return undefined
  const f = shape[head]
  if (rest.length === 0 || !f) return f
  return f.t === 'group' ? fieldAt(f.fields, rest) : undefined
}

const valueAt = (v: unknown, path: string[]): unknown =>
  path.reduce<unknown>((at, k) => (isObj(at) ? at[k] : undefined), v)

const TOKEN = /\{([\w.]+)\}/g

type Frame = { frame: string; fields: Shape }

const obj = (v: unknown): Obj => (isObj(v) ? v : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// A bracketed part drops out when any value in it is missing; elsewhere a missing one shows
// "?". Also returns the paths the frame said, so they are not repeated beneath it.
const framed = ({ frame, fields }: Frame, item: Obj, r: Render) => {
  const used: string[] = []
  const fill = (part: string, missing: () => string) =>
    part.replace(TOKEN, (_, path: string) => {
      used.push(path)
      const v = valueAt(item, path.split('.'))
      const empty = v === undefined || (Array.isArray(v) && v.length === 0)
      return empty ? missing() : shown(v, fieldAt(fields, path.split('.')), r)
    })
  const optional = (_: string, part: string) => {
    let gap = false
    const out = fill(part, () => {
      gap = true
      return ''
    })
    return gap ? '' : out
  }
  return { line: fill(frame.replace(/\[([^\]]*)\]/g, optional), () => '?'), used }
}

// The item less the values its frame already says.
const without = (item: Obj, paths: string[][]): Obj => {
  const out: Obj = {}
  for (const [k, v] of Object.entries(item)) {
    const inner = paths.filter((p) => p[0] === k).map((p) => p.slice(1))
    if (inner.some((p) => p.length === 0)) continue
    out[k] = inner.length > 0 && isObj(v) ? without(v, inner) : v
  }
  return out
}

const pad = (lines: string[], by: string) => lines.map((l) => `${by}${l}`)

const headOf = (f: ItemsField, item: unknown, r: Render): string =>
  isObj(item) ? framed({ frame: f.frame, fields: itemGroup(f).fields }, item, r).line : String(item)

// One item: its frame, then whatever the frame does not say.
const itemLines = (f: ItemsField, item: unknown, r: Render): string[] => {
  if (!isObj(item)) return [String(item)]
  const g = itemGroup(f)
  const { line, used } = framed({ frame: f.frame, fields: g.fields }, item, r)
  const rest = without(
    item,
    used.map((p) => p.split('.')),
  )
  return [line, ...groupLines(g, rest, r)]
}

const entryLine = (f: EntriesField, key: string, v: unknown, r: Render) => {
  const fields = entryGroup(f)?.fields ?? {}
  return framed({ frame: f.frame, fields }, { key, value: v, ...obj(v) }, r).line
}

const bullet = ([head, ...rest]: string[]) => [`- ${head}`, ...pad(rest, '  ')]

const listLines = (f: Field, v: unknown[], r: Render): string[] => {
  if (f.t === 'items') return v.flatMap((item) => bullet(itemLines(f, item, r)))
  const frame = f.t === 'list' ? f.item : undefined
  return v.map((x) => `- ${frame && isObj(x) ? framed(frame, x, r).line : shown(x, undefined, r)}`)
}

const fieldLines = (f: Field, v: unknown, r: Render): string[] => {
  if (v === undefined) return []
  if (f.t === 'group') return groupLines(f, obj(v), r)
  if (f.kind === 'exempt') return []
  if (f.t === 'value') return [`${f.label}: ${shown(v, f, r)}`]
  const lines =
    f.t === 'entries'
      ? Object.entries(obj(v)).map(([k, x]) => `- ${entryLine(f, k, x, r)}`)
      : listLines(f, arr(v), r)
  return lines.length === 0 ? [] : [`${f.label}:`, ...lines]
}

const groupLines = (g: GroupField, v: Obj, r: Render): string[] =>
  Object.entries(v).flatMap(([k, x]) => fieldLines(fieldIn(g.fields, k), x, r))

const itemChange = (f: ItemsField, b: unknown, a: unknown, r: Render): string[] => {
  if (b === undefined) {
    const [head = '', ...rest] = itemLines(f, a, r)
    return [`Added to ${f.label}: ${head}`, ...pad(rest, '  ')]
  }
  if (same(a, b)) return []
  // A plain item that became a limited one, or back, has no field to compare, so the new
  // item is shown whole.
  if (!(isObj(a) && isObj(b))) {
    const [head = '', ...rest] = itemLines(f, a, r)
    return [`Changed in ${f.label}: ${head}`, ...pad(rest, '  ')]
  }
  const inner = groupChanges(itemGroup(f), b, a, r)
  if (inner.length === 0) return []
  return [`Changed in ${f.label}: ${headOf(f, a, r)}`, ...pad(inner, '  ')]
}

const itemsChanges = (f: ItemsField, before: unknown[], after: unknown[], r: Render): string[] => {
  const id = (x: unknown) => idOf(f, x)
  const gone = before.filter((b) => !after.some((a) => id(a) === id(b)))
  return [
    ...gone.map((b) => `Removed from ${f.label}: ${headOf(f, b, r)}`),
    ...after.flatMap((a) =>
      itemChange(
        f,
        before.find((b) => id(b) === id(a)),
        a,
        r,
      ),
    ),
  ]
}

const entriesChanges = (f: EntriesField, before: Obj, after: Obj, r: Render): string[] => {
  const line = (k: string, v: unknown) => entryLine(f, k, v, r)
  const gone = Object.keys(before).filter((k) => !(k in after))
  const changed = Object.entries(after).filter(([k, a]) => !same(a, before[k]))
  return [
    ...gone.map((k) => `Removed from ${f.label}: ${line(k, before[k])}`),
    ...changed.map(([k, a]) =>
      k in before
        ? `${f.label}: ${line(k, a)} (was ${line(k, before[k])})`
        : `Added to ${f.label}: ${line(k, a)}`,
    ),
  ]
}

const valueChange = (f: Exclude<Field, GroupField>, b: unknown, a: unknown, r: Render): string => {
  if (a === undefined) return `${f.label}: left out (was ${shown(b, f, r)})`
  const now = `${f.label}: ${shown(a, f, r)}`
  return b === undefined ? now : `${now} (was ${shown(b, f, r)})`
}

const fieldChanges = (f: Field, b: unknown, a: unknown, r: Render): string[] => {
  if (same(a, b)) return []
  if (f.t === 'group') return groupChanges(f, obj(b), obj(a), r)
  if (f.kind === 'exempt') return []
  if (f.t === 'value' || a === undefined) return [valueChange(f, b, a, r)]
  if (f.t === 'entries') return entriesChanges(f, obj(b), obj(a), r)
  if (f.t === 'items') return itemsChanges(f, arr(b), arr(a), r)
  const list = arr(a)
  return list.length === 0 ? [`${f.label}: none`] : [`${f.label}:`, ...listLines(f, list, r)]
}

const groupChanges = (g: GroupField, before: Obj, after: Obj, r: Render): string[] => {
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])]
  return keys.flatMap((k) => fieldChanges(fieldIn(g.fields, k), before[k], after[k], r))
}

export const NOTHING_SHOWN = 'Only details the summary leaves out change.'

export const dataSummary = (
  root: GroupField,
  before: Obj | undefined,
  after: Obj,
  locale: string,
) => {
  const r = { locale }
  const lines =
    before === undefined ? groupLines(root, after, r) : groupChanges(root, before, after, r)
  return lines.length > 0 ? lines : [NOTHING_SHOWN]
}

// common(i, j): how many lines prev from i and next from j have in common, in order.
const commonRuns = (prev: string[], next: string[]) => {
  const width = next.length + 1
  const table = new Int32Array((prev.length + 1) * width)
  const at = (i: number, j: number) => table[i * width + j] ?? 0
  for (let i = prev.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      table[i * width + j] =
        prev[i] === next[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  return at
}

// The changed lines of a text file, by a longest common subsequence of its lines; a new
// file shows its whole text. A changed line shows as removed, then added.
export const textSummary = (before: string | undefined, after: string): string[] => {
  const next = after.replace(/\n$/, '').split('\n')
  if (before === undefined) return next
  const prev = before.replace(/\n$/, '').split('\n')
  const common = commonRuns(prev, next)
  const out: string[] = []
  const note = (word: string, line: string | undefined) => {
    if (line?.trim()) out.push(`${word}: ${line}`)
  }
  let i = 0
  let j = 0
  while (i < prev.length || j < next.length) {
    const removing = i < prev.length && (j === next.length || common(i + 1, j) >= common(i, j + 1))
    if (i < prev.length && j < next.length && prev[i] === next[j]) {
      i++
      j++
    } else if (removing) note('Removed', prev[i++])
    else note('Added', next[j++])
  }
  return out.length > 0 ? out : [NOTHING_SHOWN]
}
