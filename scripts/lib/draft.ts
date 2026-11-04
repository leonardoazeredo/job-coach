// Makes a Draft: a proposed version of one Profile or master CV file. The input merges into the
// file, or into its template for a new file, by the file's table (draft-table.ts); the result
// must read back through the file's schema as the same values; and the summary is rendered
// from those values, so what is written is exactly what was shown.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { DataTable, Field, GroupField } from './draft-fields.ts'
import { fieldIn, isObj, itemGroup, merge, type Obj } from './draft-merge.ts'
import { keepDraft, type Open, readIfThere } from './draft-store.ts'
import { dataSummary, type Render, textSummary } from './draft-summary.ts'
import { TABLES } from './draft-table.ts'
import { yamlText } from './draft-yaml.ts'
import { PLACEHOLDER } from './onboarding.ts'
import { error, type Problem } from './problem.ts'
import { describe } from './read-file.ts'
import { repoRoot, type Workspace } from './workspace.ts'

export const DRAFTABLE = Object.keys(TABLES)

// Templates are engine files, so they are read beside this script, not in the user's folder.
const TEMPLATES = join(repoRoot(), 'templates')

// The identity's own default; a locale that is not a language tag falls back to it too.
const FALLBACK_LOCALE = 'en-US'

// The identity's first draft carries its own locale; every other file takes the identity's.
const localeOf = (file: string, data: Obj, open: () => Workspace): string => {
  const own = file === 'profile/identity.yaml' ? data.locale : open().identity().identity?.locale
  try {
    return (
      Intl.getCanonicalLocales(typeof own === 'string' ? own : FALLBACK_LOCALE)[0] ??
      FALLBACK_LOCALE
    )
  } catch {
    return FALLBACK_LOCALE
  }
}

const PACK_ID = /^[a-z0-9][a-z0-9-]*$/

// A pack's name: the label its own file gives, else the words of its id.
const packName =
  (root: string) =>
  (id: string): string => {
    try {
      if (PACK_ID.test(id)) {
        const file = parse(readFileSync(join(root, 'config/competencies', `${id}.yaml`), 'utf8'))
        if (isObj(file) && typeof file.label === 'string' && file.label.trim()) return file.label
      }
    } catch {
      // An unreadable pack file leaves the id's words.
    }
    const words = id.replaceAll('-', ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }

// What a summary needs to word values the way the user reads them. The jobs come from the
// history on disk, so a history drafted in the same turn does not name its jobs yet.
const renderFor = (root: string, file: string, data: Obj, open: () => Workspace): Render => {
  const pay = data.compensation
  const currency = isObj(pay) && typeof pay.currency === 'string' ? pay.currency : undefined
  const { history } = open().history()
  return {
    locale: localeOf(file, data, open),
    ...(currency ? { currency } : {}),
    ...(history
      ? { jobs: new Map(history.map((j) => [j.id, `${j.public.title} at ${j.company}`])) }
      : {}),
    pack: packName(root),
  }
}

const stepInto = (at: unknown, step: string | number): unknown => {
  if (Array.isArray(at)) return at[Number(step)]
  return isObj(at) ? at[String(step)] : undefined
}

// A key path in words, named the way the merge names a value.
const labelAt = (root: GroupField, path: (string | number)[], data: unknown): string => {
  let field: Field = root
  let at = data
  let where = ''
  let label = ''
  for (const step of path) {
    at = stepInto(at, step)
    if (field.t === 'group') field = fieldIn(field.fields, String(step))
    else if (field.t === 'items') {
      where = `${String(isObj(at) ? at[field.id] : at)} in ${field.label}`
      field = itemGroup(field)
    } else break
    if (field.t !== 'group') label = field.label
  }
  return where ? `"${label}" (${where})` : `"${label}"`
}

const still = (file: string, names: string[]): Problem[] =>
  names.map((name) =>
    error(
      file,
      `${name} still holds the template's example; give a value, or null to leave it out`,
    ),
  )

type Shaped = { text: string; summary: string[]; same: boolean } | { problems: Problem[] }
type Target = { root: string; file: string; table: DataTable; existing: string | undefined }

const readBase = (
  { file, existing }: Target,
  read: (t: string) => unknown,
): { base?: Obj; problems?: Problem[] } => {
  if (existing === undefined) return {}
  try {
    const base = read(existing)
    if (isObj(base)) return { base }
    return { problems: [error(file, 'could not be read: it holds no named values')] }
  } catch (e) {
    return { problems: [error(file, `could not be read: ${describe(e)}`)] }
  }
}

// The text must give back exactly the merged values, and pass the file's schema.
const readBack = (target: Target, text: string, data: Obj, read: (t: string) => unknown) => {
  try {
    const back = read(text)
    if (JSON.stringify(back) !== JSON.stringify(data))
      throw new Error('the text does not hold the values given')
    target.table.schema?.parse(back)
    return []
  } catch (e) {
    return [error(target.file, `the draft would not read back: ${describe(e)}`)]
  }
}

const shapeData = (target: Target, input: Obj, open: () => Workspace): Shaped => {
  const { root, file, table, existing } = target
  const read = table.format === 'json' ? (t: string) => JSON.parse(t) : (t: string) => parse(t)
  const tplText = readFileSync(join(TEMPLATES, table.template), 'utf8')
  const tpl = read(tplText)
  const found = readBase(target, read)
  if (found.problems) return { problems: found.problems }
  const fresh = found.base === undefined
  const base: Obj = found.base ?? tpl
  const merged = merge(table.root, { base, input, tpl }, fresh)
  if (merged.problems.length > 0) return { problems: merged.problems.map((m) => error(file, m)) }
  const change = { before: base, after: merged.data, given: input }
  const y =
    table.format === 'yaml' ? yamlText(existing ?? tplText, fresh, change, table.root) : undefined
  const text = y?.text ?? `${JSON.stringify(merged.data, null, 2)}\n`
  const remaining = [
    ...merged.remaining,
    ...(y?.marked ?? []).map((p) => labelAt(table.root, p, merged.data)),
  ]
  if (remaining.length > 0) return { problems: still(file, [...new Set(remaining)]) }
  const unread = readBack(target, text, merged.data, read)
  if (unread.length > 0) return { problems: unread }
  return {
    text,
    // Taking out a mark alone still changes the file, and what onboarding counts.
    same: !fresh && !y?.stripped && JSON.stringify(base) === JSON.stringify(merged.data),
    summary: dataSummary(
      table.root,
      fresh ? undefined : base,
      merged.data,
      renderFor(root, file, merged.data, open),
    ),
  }
}

export type DraftResult =
  | { kind: 'not-values'; reason: string }
  | { kind: 'refused'; problems: Problem[] }
  | { kind: 'unchanged' }
  | { kind: 'drafted'; summary: string[] }

const parseValues = (input: string): { values: Obj } | { reason: string } => {
  try {
    const values: unknown = JSON.parse(input)
    return isObj(values) ? { values } : { reason: 'the input is not a set of named values' }
  } catch (e) {
    return { reason: describe(e) }
  }
}

// `file` must be one of DRAFTABLE. A refused or unchanged draft keeps nothing; a new draft of
// a file replaces the one waiting.
export const makeDraft = (
  root: string,
  file: string,
  input: string,
  deps: { open: Open; now: Date },
): DraftResult => {
  const table = TABLES[file]
  if (!table)
    return { kind: 'refused', problems: [error(file, 'is not a file a draft is made of')] }
  const existing = readIfThere(join(root, file))
  let shaped: Shaped
  if (table.format === 'text')
    shaped = input.includes(PLACEHOLDER)
      ? { problems: still(file, ['The text']) }
      : { text: input, same: input === existing, summary: textSummary(existing, input) }
  else {
    const parsed = parseValues(input)
    if ('reason' in parsed) return { kind: 'not-values', reason: parsed.reason }
    shaped = shapeData({ root, file, table, existing }, parsed.values, () => deps.open(root))
  }
  if ('problems' in shaped) return { kind: 'refused', problems: shaped.problems }
  if (shaped.same) return { kind: 'unchanged' }
  keepDraft(root, file, shaped.text, deps.now)
  return { kind: 'drafted', summary: shaped.summary }
}
