// The vocabulary of a Draft table (draft-table.ts): what each key of a Profile file is, how a
// summary names it, and how its value merges with what the file already holds.
import type { ZodType } from 'zod'
import { NOT_SPECIFIED } from './not-specified.ts'

// sample: the template's value is only an example, so it must be given or declared left out.
// default: the template's value stands unless given, and is shown like any value.
// exempt: kept or given, never shown in a summary.
export type Kind = 'sample' | 'default' | 'exempt'

// What a value must be, checked only when a draft gives it. `needs` finishes the sentence
// "<label> needs ...".
export type Rule = { holds: (v: unknown) => boolean; needs: string }

// `later` marks a key the template leaves out because a later step adds it.
type Common = { label: string; kind: Kind; later?: true }
// A value a summary words rather than repeats: a pay in the draft's currency, a job id as the
// job's title and company, a pack id as its name, a locale as its language.
export type Reading = 'money' | 'job' | 'pack' | 'locale' | 'currency'
// `standIn` is the text the file keeps for an unknown value; a summary says `says` instead.
export type ValueField = Common & {
  t: 'value'
  date?: true
  as?: Reading
  standIn?: { text: string; says: string }
  // Words for fixed values the file keeps as codes a person would not say.
  words?: Record<string, string>
  rule?: Rule
}
// A list without an id key: given, it replaces the whole list. `item` frames object items.
// `as` reads its entries as job ids or as level names; `note` is said once beneath the list.
export type ListField = Common & {
  t: 'list'
  item?: { frame: string; fields: Shape }
  as?: 'job' | 'level'
  note?: string
  // Holds for each entry.
  rule?: Rule
}
// A list whose items carry an id key: given items merge into it by that key. A string item is
// its own id. `open` lets an item hold keys the template does not name.
export type ItemsField = Common & {
  t: 'items'
  id: string
  frame: string
  fields: Shape
  open?: true
  // An item holding nothing but its id has nothing to show, so it is not shown.
  quiet?: true
}
// A map keyed by the user's own words (countries, levels): merged key by key. The frame names
// {key} and either {value} or the fields of `value`. `levels` reads the keys as level names.
export type EntriesField = Common & {
  t: 'entries'
  frame: string
  value?: Shape
  levels?: true
}
export type GroupField = { t: 'group'; fields: Shape; open?: true; later?: true }
export type Field = ValueField | ListField | ItemsField | EntriesField | GroupField
export type Shape = Record<string, Field>

type Values = Record<string, unknown>

export type DataTable = {
  format: 'yaml' | 'json'
  template: string
  root: GroupField
  schema?: ZodType
  // Lines the summary adds about what the values will do, from the file as it would be and as it
  // was, undefined for a new file.
  notes?: (now: Values, was: Values | undefined) => string[]
}
// The markdown files take their whole text, so they have no keys.
export type TextTable = { format: 'text'; template: string }
export type Table = DataTable | TextTable

export const value = (label: string, kind: Kind = 'sample', date?: 'date'): ValueField => ({
  t: 'value',
  label,
  kind,
  ...(date ? { date: true } : {}),
})
export const list = (
  label: string,
  kind: Kind = 'sample',
  item?: ListField['item'],
): ListField => ({
  t: 'list',
  label,
  kind,
  ...(item ? { item } : {}),
})
export const group = (fields: Shape, open?: 'open'): GroupField => ({
  t: 'group',
  fields,
  ...(open ? { open: true } : {}),
})
export const items = (
  label: string,
  spec: { id: string; frame: string; fields: Shape; open?: true; quiet?: true },
  kind: Kind = 'sample',
): ItemsField => ({ t: 'items', label, kind, ...spec })
export const entries = (
  label: string,
  frame: string,
  valueShape?: Shape,
  levels?: 'levels',
): EntriesField => ({
  t: 'entries',
  label,
  kind: 'sample',
  frame,
  ...(valueShape ? { value: valueShape } : {}),
  ...(levels ? { levels: true } : {}),
})
export const later = <F extends Field>(field: F): F => ({ ...field, later: true })
export const ruled = <F extends ValueField | ListField>(field: F, rule: Rule): F => ({
  ...field,
  rule,
})
// A summary words this value instead of repeating it.
export const reading = (field: ValueField, as: Reading): ValueField => ({ ...field, as })
export const wording = (field: ValueField, words: Record<string, string>): ValueField => ({
  ...field,
  words,
})
export const ofJobs = (field: ListField): ListField => ({ ...field, as: 'job' })
export const ofLevels = (field: ListField): ListField => ({ ...field, as: 'level' })
export const noting = (field: ListField, note: string): ListField => ({ ...field, note })
// The file keeps `text` for an unknown value (cv-lint and the sources check compare against it);
// the user is told `says`.
export const standingIn = (field: ValueField, says: string): ValueField => ({
  ...field,
  standIn: { text: NOT_SPECIFIED, says },
})
