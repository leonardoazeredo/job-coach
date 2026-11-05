// Applies a Draft's input to what a Profile file holds, or to its template for a new file, by
// the file's table: a key given sets its value, null leaves it out, an absent key keeps what is
// there. Lists with an id key merge item by item; other lists and values are replaced whole.
// Reports what the input cannot mean and every sample value still left in place.
import {
  type EntriesField,
  type Field,
  type GroupField,
  group,
  type ItemsField,
  type ListField,
  type Shape,
  type ValueField,
  value,
} from './draft-fields.ts'
import { PLACEHOLDER } from './onboarding.ts'

export type Obj = { [key: string]: unknown }
export const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// A key the table does not name, under a group that allows one.
export const extraField = (key: string): Field => value(key.replaceAll('_', ' '), 'default')
export const fieldIn = (shape: Shape, key: string): Field => shape[key] ?? extraField(key)
export const itemGroup = (f: ItemsField): GroupField =>
  f.open ? group(f.fields, 'open') : group(f.fields)
export const entryGroup = (f: EntriesField): GroupField | undefined =>
  f.value ? group(f.value) : undefined
export const idOf = (f: ItemsField, item: unknown): unknown => {
  if (typeof item === 'string') return item
  return isObj(item) ? item[f.id] : undefined
}

export type Merged = { data: Obj; problems: string[]; remaining: string[] }

type Ctx = {
  // The value merged into came from the template, so its samples are not the user's.
  fromTemplate: boolean
  // Where the value sits, in words, for a problem about it.
  where: string
  problems: string[]
  remaining: Set<string>
}

// What one key holds now, what the input gives for it, and the template's value there.
type At = { base: unknown; given: unknown; tpl: unknown }

const named = (where: string, label: string) => (where ? `"${label}" (${where})` : `"${label}"`)
const labelOf = (field: Field, key: string): string => (field.t === 'group' ? key : field.label)
const scalar = (v: unknown) => ['string', 'number', 'boolean'].includes(typeof v)
const marked = (v: unknown) => JSON.stringify(v ?? null).includes(PLACEHOLDER)

// A year-month or a day that the calendar does not have. Other texts (a year, "present") are not
// dates the summary rewords, so they stay as written.
const notADate = (v: unknown): boolean => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v) : null
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  return probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d
}

const keepSample = (field: Field, base: unknown, ctx: Ctx, label: string) => {
  if (!ctx.fromTemplate || base === undefined) return
  if (field.t !== 'group') {
    if (field.kind === 'sample') ctx.remaining.add(named(ctx.where, label))
    return
  }
  if (isObj(base))
    for (const [k, f] of Object.entries(field.fields)) keepSample(f, base[k], ctx, labelOf(f, k))
}

const breaksRule = (field: ValueField | ListField, v: unknown, ctx: Ctx, label: string) => {
  if (!field.rule || field.rule.holds(v)) return false
  ctx.problems.push(`${named(ctx.where, label)} needs ${field.rule.needs}: ${String(v)}`)
  return true
}

const mergeField = (field: Field, at: At, ctx: Ctx, label: string): unknown => {
  if (at.given === undefined) {
    keepSample(field, at.base, ctx, label)
    return at.base
  }
  switch (field.t) {
    case 'group':
      return mergeGroup(field, at, ctx)
    case 'items':
      return mergeItems(field, at, ctx)
    case 'entries':
      return mergeEntries(field, at, ctx)
    case 'list':
      if (!Array.isArray(at.given)) {
        ctx.problems.push(`${named(ctx.where, label)} needs a list`)
        return at.base
      }
      for (const entry of at.given) breaksRule(field, entry, ctx, label)
      return at.given
    case 'value':
      if (field.date && notADate(at.given)) {
        ctx.problems.push(`${named(ctx.where, label)} is not a real date: ${at.given}`)
        return at.base
      }
      if (breaksRule(field, at.given, ctx, label)) return at.base
      if (scalar(at.given)) return at.given
      ctx.problems.push(`${named(ctx.where, label)} needs a single value`)
      return at.base
  }
}

const mergeGroup = (g: GroupField, at: At, ctx: Ctx): Obj => {
  const out: Obj = isObj(at.base) ? { ...at.base } : {}
  const { given, tpl } = at
  if (!isObj(given)) {
    ctx.problems.push(`${ctx.where ? `${ctx.where} ` : ''}needs a set of named values`)
    return out
  }
  const unknown = Object.keys(given).filter((k) => !(k in g.fields) && !g.open)
  for (const key of unknown)
    ctx.problems.push(`there is no place for "${key}"${ctx.where ? ` in ${ctx.where}` : ''}`)
  const keys = [...new Set([...Object.keys(g.fields), ...Object.keys(given)])]
  for (const key of keys.filter((k) => !unknown.includes(k))) {
    const field = fieldIn(g.fields, key)
    const v = given[key]
    const sub = { base: out[key], given: v, tpl: isObj(tpl) ? tpl[key] : undefined }
    const merged = v === null ? undefined : mergeField(field, sub, ctx, labelOf(field, key))
    if (merged === undefined) delete out[key]
    else out[key] = merged
  }
  return out
}

const removal = (item: unknown): unknown =>
  isObj(item) && Object.keys(item).length === 1 ? item.remove : undefined

type ItemList = { f: ItemsField; out: unknown[]; shape: unknown }

// The template's first object item is the shape of a new item, so its defaults (a win's
// status, a job's employment type) are kept and its samples must be given.
const mergeItems = (f: ItemsField, at: At, ctx: Ctx) => {
  if (!Array.isArray(at.given)) {
    ctx.problems.push(`${named(ctx.where, f.label)} needs a list`)
    return at.base
  }
  const list: ItemList = {
    f,
    // The template's items are examples, so a new file holds only the given ones.
    out: ctx.fromTemplate || !Array.isArray(at.base) ? [] : [...at.base],
    shape: Array.isArray(at.tpl) ? at.tpl.find(isObj) : undefined,
  }
  for (const item of at.given) applyItem(list, item, ctx)
  return list.out
}

const applyItem = (list: ItemList, item: unknown, ctx: Ctx) => {
  const { f, out } = list
  const gone = removal(item)
  const id = gone ?? idOf(f, item)
  const i = out.findIndex((x) => idOf(f, x) === id)
  const label = named(ctx.where, f.label)
  if (typeof id !== 'string') ctx.problems.push(`each of ${label} needs its "${f.id}"`)
  else if (gone === undefined)
    out.splice(i === -1 ? out.length : i, 1, mergeItem(list, out[i], item, ctx))
  else if (i === -1) ctx.problems.push(`${label} has no "${id}" to remove`)
  else out.splice(i, 1)
}

const mergeItem = ({ f, shape }: ItemList, old: unknown, item: unknown, ctx: Ctx) => {
  if (typeof item === 'string' || typeof old === 'string') return item
  const where = `${String(idOf(f, item))} in ${f.label}`
  const inner = { ...ctx, fromTemplate: old === undefined, where }
  return mergeGroup(itemGroup(f), { base: old ?? shape, given: item, tpl: shape }, inner)
}

const mergeEntries = (f: EntriesField, at: At, ctx: Ctx) => {
  if (!isObj(at.given)) {
    ctx.problems.push(`${named(ctx.where, f.label)} needs a set of named values`)
    return at.base
  }
  // As with items, a new file drops the template's example entries.
  const out: Obj = ctx.fromTemplate || !isObj(at.base) ? {} : { ...at.base }
  const shape = entryGroup(f)
  for (const [key, v] of Object.entries(at.given)) {
    const inner = { ...ctx, fromTemplate: false, where: `${key} in ${f.label}` }
    if (v === null || (typeof v === 'string' && v.trim() === '')) delete out[key]
    else if (shape)
      out[key] = mergeGroup(shape, { base: out[key], given: v, tpl: undefined }, inner)
    else if (scalar(v)) out[key] = v
    else ctx.problems.push(`${named(ctx.where, f.label)} needs a single value for "${key}"`)
  }
  return out
}

type Spot = { where: string; label: string }

// A value, or a key the user chose, still holding the template's marker was never answered,
// whatever its kind.
const markers = (field: Field, v: unknown, spot: Spot, out: Set<string>) => {
  if (!marked(v)) return
  if (field.t === 'items' && Array.isArray(v)) {
    for (const item of v.filter(marked)) {
      const id = String(idOf(field, item) ?? '')
      const whole = typeof item === 'string' || id.includes(PLACEHOLDER)
      if (whole) out.add(named(spot.where, spot.label))
      else markers(itemGroup(field), item, { where: `${id} in ${field.label}`, label: '' }, out)
    }
    return
  }
  if (field.t !== 'group' || !isObj(v)) {
    out.add(named(spot.where, spot.label))
    return
  }
  for (const [k, inner] of Object.entries(v)) {
    const sub = fieldIn(field.fields, k)
    markers(sub, inner, { where: spot.where, label: labelOf(sub, k) }, out)
  }
}

export const merge = (
  root: GroupField,
  at: { base: Obj; input: Obj; tpl: Obj },
  fromTemplate: boolean,
): Merged => {
  const ctx: Ctx = { fromTemplate, where: '', problems: [], remaining: new Set() }
  const data = mergeGroup(root, { base: at.base, given: at.input, tpl: at.tpl }, ctx)
  markers(root, data, { where: '', label: '' }, ctx.remaining)
  return { data, problems: ctx.problems, remaining: [...ctx.remaining] }
}
