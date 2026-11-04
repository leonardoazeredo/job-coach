// The summary of a Draft, rendered from the same value that is written: every shown value of a
// new file, or only what changes in an existing one. Scalars render as their label and value,
// list items through their table's frame, ISO dates and pay in the user's locale, yes and no as
// words, job ids as the job; the rest verbatim.
import type {
  EntriesField,
  Field,
  GroupField,
  ItemsField,
  Reading,
  Shape,
  ValueField,
} from './draft-fields.ts'
import { entryGroup, fieldIn, idOf, isObj, itemGroup, type Obj } from './draft-merge.ts'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export type Render = {
  locale: string
  // The currency of the draft's own pay, when it names one.
  currency?: string
  // The currency the file's pay was in before the draft, for the "was" side of a change.
  wasCurrency?: string
  // Title and company by job id; undefined when the job history cannot be read.
  jobs?: Map<string, string>
  pack: (id: string) => string
}

const blank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const prior = (r: Render): Render => {
  const { currency: _, wasCurrency, ...rest } = r
  return wasCurrency ? { ...rest, currency: wasCurrency } : rest
}

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

// A number with the digits grouped for the locale, in the draft's currency when it has one.
const moneyIn = (n: number, { locale, currency }: Render): string => {
  try {
    const options: Intl.NumberFormatOptions = currency
      ? { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }
      : {}
    return new Intl.NumberFormat(locale, options).format(n)
  } catch {
    return new Intl.NumberFormat(locale).format(n)
  }
}

// A locale that is not a language tag stays as written.
const languageOf = (tag: string): string => {
  try {
    return (
      new Intl.DisplayNames('en', { type: 'language', languageDisplay: 'dialect' }).of(tag) ?? tag
    )
  } catch {
    return tag
  }
}

const jobIn = (id: string, { jobs }: Render): string =>
  jobs ? (jobs.get(id) ?? 'a job that is not in your job history') : 'a job'

const jobsIn = (ids: unknown[], r: Render): string => {
  if (r.jobs) return new Intl.ListFormat('en').format(ids.map((id) => jobIn(String(id), r)))
  return ids.length === 1 ? 'one of your jobs' : `${ids.length} of your jobs`
}

const READ: Record<Exclude<Reading, 'money'>, (v: string, r: Render) => string> = {
  job: jobIn,
  pack: (v, r) => r.pack(v),
  locale: languageOf,
}

const plain = (v: unknown): string => (isObj(v) ? JSON.stringify(v) : String(v))

const valueShown = (v: unknown, field: ValueField, r: Render): string => {
  if (field.standIn && field.standIn.text === v) return field.standIn.says
  if (typeof v === 'number' && field.as === 'money') return moneyIn(v, r)
  if (typeof v === 'string' && field.as && field.as !== 'money') return READ[field.as](v, r)
  if (typeof v === 'string' && field.date) return dateIn(v, r)
  return plain(v)
}

const shown = (v: unknown, field: Field | undefined, r: Render): string => {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (Array.isArray(v)) {
    if (field?.t === 'list' && field.says) return field.says
    if (field?.t === 'list' && field.as === 'job') return jobsIn(v, r)
    return v.map((x) => shown(x, undefined, r)).join(', ')
  }
  return field?.t === 'value' ? valueShown(v, field, r) : plain(v)
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
      const empty = blank(v) || (Array.isArray(v) && v.length === 0)
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
  if (blank(v)) return []
  if (f.t === 'group') return groupLines(f, obj(v), r)
  if (f.kind === 'exempt') return []
  if (f.t === 'value') return [`${f.label}: ${shown(v, f, r)}`]
  const lines =
    f.t === 'entries'
      ? Object.entries(obj(v))
          .filter(([, x]) => !blank(x))
          .map(([k, x]) => `- ${entryLine(f, k, x, r)}`)
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
  // A list the frame already says, such as the jobs of a limit, is not repeated beneath it.
  const said = framed({ frame: f.frame, fields: itemGroup(f).fields }, a, r).used
  const skip = said.filter((p) => fieldAt(itemGroup(f).fields, p.split('.'))?.t === 'list')
  const gone = skip.map((p) => p.split('.'))
  const inner = groupChanges(itemGroup(f), without(b, gone), without(a, gone), r)
  // Only what the frame says may have changed, such as whether a claim is checked.
  if (inner.length === 0)
    return headOf(f, a, r) === headOf(f, b, r) ? [] : [`Changed in ${f.label}: ${headOf(f, a, r)}`]
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
  const line = (k: string, v: unknown, at = r) => entryLine(f, k, v, at)
  const had = (o: Obj) => Object.fromEntries(Object.entries(o).filter(([, x]) => !blank(x)))
  const [was, now] = [had(before), had(after)]
  const gone = Object.keys(was).filter((k) => !(k in now))
  const changed = Object.entries(now).filter(([k, a]) => !same(a, was[k]))
  return [
    ...gone.map((k) => `Removed from ${f.label}: ${line(k, was[k], prior(r))}`),
    ...changed.map(([k, a]) =>
      k in was
        ? `${f.label}: ${line(k, a)} (was ${line(k, was[k], prior(r))})`
        : `Added to ${f.label}: ${line(k, a)}`,
    ),
  ]
}

// An empty value is no value, so it is neither shown nor said to have been.
const valueChange = (f: ValueField, b: unknown, a: unknown, r: Render): string[] => {
  const was = shown(b, f, prior(r))
  if (blank(a)) return blank(b) ? [] : [`${f.label}: left out (was ${was})`]
  // Without the job history both ids read "a job", which would show no change.
  if (f.as === 'job' && !r.jobs && !blank(b) && a !== b)
    return [`${f.label}: changed (your job history could not be read)`]
  const now = `${f.label}: ${shown(a, f, r)}`
  return [blank(b) ? now : `${now} (was ${was})`]
}

const fieldChanges = (f: Field, b: unknown, a: unknown, r: Render): string[] => {
  if (same(a, b)) return []
  if (f.t === 'group') return groupChanges(f, obj(b), obj(a), r)
  if (f.kind === 'exempt') return []
  if (f.t === 'value') return valueChange(f, b, a, r)
  if (f.t === 'entries') return entriesChanges(f, obj(b), obj(a), r)
  if (f.t === 'items') return itemsChanges(f, arr(b), arr(a), r)
  const list = arr(a)
  return list.length === 0 ? [`${f.label}: none`] : [`${f.label}:`, ...listLines(f, list, r)]
}

const groupChanges = (g: GroupField, before: Obj, after: Obj, r: Render): string[] => {
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])]
  return keys.flatMap((k) => fieldChanges(fieldIn(g.fields, k), before[k], after[k], r))
}

export const NOTHING_SHOWN =
  "Nothing you said changes. Only the coach's own tags and codes are updated."

export const dataSummary = (root: GroupField, before: Obj | undefined, after: Obj, r: Render) => {
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
  return out.length > 0 ? out : ['Only blank lines or spaces change.']
}
