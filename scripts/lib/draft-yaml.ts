// Turns a merged value back into YAML text by editing the document it came from, so the
// comments a user wrote in their own file survive and every key keeps its place. A new file
// starts from the template's document with all of its comments taken out.
//
// The template's marks (comments naming the placeholder) found in an existing Profile file, and
// what a draft makes of each: answered, so it goes (the input names the value, the draft changes
// or drops it, or the mark is in the file's header); still on a sample the draft leaves alone, so
// the draft is refused; or a note the user wrote, so it stays as written.
import {
  type Document,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  type Pair,
  parseDocument,
  visit,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'
import {
  type Field,
  fieldIn,
  type GroupField,
  groupOf,
  type ItemsField,
  idOf,
  isObj,
  type Obj,
  same,
} from './draft-fields.ts'
import { PLACEHOLDER } from './onboarding.ts'

type Commented = { comment?: string | null; commentBefore?: string | null }
type Path = (string | number)[]
type Change = { before: unknown; after: unknown }

const keyOf = (pair: Pair): string => String(isScalar(pair.key) ? pair.key.value : pair.key)
const isMark = (c: string | null | undefined) => c?.includes(PLACEHOLDER) === true

const childField = (field: Field | undefined, key: string): Field | undefined => {
  if (field?.t === 'group') return fieldIn(field.fields, key)
  if (field?.t === 'entries') return groupOf(field)
  return undefined
}

// The key path to a node: each pair's key, and each item's place in its list.
const pathTo = (node: unknown, ancestors: readonly unknown[]): Path => {
  const chain = [...ancestors, node]
  const keys: Path = []
  chain.forEach((step, i) => {
    const parent = chain[i - 1]
    if (isPair(step)) keys.push(keyOf(step))
    else if (isSeq(parent) && isNode(step)) keys.push(parent.items.indexOf(step))
  })
  return keys
}

// The template's header lands on the first key when no blank line follows it, so a mark there
// above the key is the header's, not the key's.
const isHeader = (node: unknown, ancestors: readonly unknown[]): boolean => {
  const [, map, pair] = ancestors
  return (
    ancestors.length === 3 &&
    isMap(map) &&
    map.items[0] === pair &&
    isPair(pair) &&
    pair.key === node
  )
}

// One mark: where it sits, and how to take it out, which says whether there was one to take.
type Mark = { path: Path; header: boolean; clear: () => boolean }

const clearing = (node: Commented, side: 'comment' | 'commentBefore') => () => {
  if (!isMark(node[side])) return false
  node[side] = null
  return true
}

// Every mark beside a value or on the line above it, on a value, a list, a map or a key. A mark
// on the whole document, or above its first key, is its header.
const findMarks = (doc: Document): Mark[] => {
  const found: Mark[] = [
    { path: [], header: true, clear: clearing(doc, 'commentBefore') },
    { path: [], header: true, clear: clearing(doc, 'comment') },
  ]
  visit(doc, (_, node, ancestors) => {
    if (!isNode(node)) return
    const path = pathTo(node, ancestors)
    const top = path.length === 0
    if (isMark(node.commentBefore))
      found.push({
        path,
        header: top || isHeader(node, ancestors),
        clear: clearing(node, 'commentBefore'),
      })
    if (isMark(node.comment)) found.push({ path, header: top, clear: clearing(node, 'comment') })
  })
  return found
}

const step = (v: unknown, key: string | number): unknown => {
  if (Array.isArray(v)) return v[Number(key)]
  return isObj(v) ? v[String(key)] : undefined
}

// Stands for a key the draft's input does not reach.
const UNSAID = Symbol('unsaid')

const itemSaid = (given: unknown, f: ItemsField, was: unknown) => {
  if (!Array.isArray(given)) return UNSAID
  const found = given.find((x) => idOf(f, x) === idOf(f, was))
  return found === undefined ? UNSAID : found
}

const keySaid = (given: unknown, key: string) =>
  isObj(given) && key in given ? given[key] : UNSAID

// An input that holds a value here, rather than keys to look into, answers the whole of it.
const answers = (given: unknown, field: Field | undefined) =>
  given !== UNSAID && !isObj(given) && !(Array.isArray(given) && field?.t === 'items')

type Walk = {
  field: Field | undefined
  // A group of the table's own, not the values of one entry or item.
  section: boolean
  // The id key of the item the walk is in: the input names it only to reach the item.
  idKey: string | undefined
  before: unknown
  after: unknown
  given: unknown
  out: Path
}

// One step of a marked path: into an item by its place in the file as it was, matched to the
// merged item by its id, or into a key.
const walkInto = (w: Walk, key: string | number): Walk | undefined => {
  const { field } = w
  if (field?.t === 'items' && Array.isArray(w.before) && Array.isArray(w.after)) {
    const was = w.before[Number(key)]
    const at = w.after.findIndex((x) => idOf(field, x) === idOf(field, was))
    if (at === -1) return undefined
    const given = w.given === UNSAID ? UNSAID : itemSaid(w.given, field, was)
    const next = { before: was, after: w.after[at], given, out: [...w.out, at] }
    return { ...next, field: groupOf(field), section: false, idKey: field.id }
  }
  const child = childField(field, String(key))
  const named = w.given === UNSAID || key === w.idKey ? UNSAID : keySaid(w.given, String(key))
  return {
    field: child,
    section: field?.t === 'group' && child?.t === 'group',
    idKey: undefined,
    before: step(w.before, key),
    after: step(w.after, key),
    given: named,
    out: [...w.out, key],
  }
}

type Under = { field: Field | undefined; before: unknown; after: unknown; given: unknown }

// Whether every value under a mark is named by the input or changed by the draft, so the
// mark is answered in full. An item's id does not count: the input gives it only to find the item.
const covers = (u: Under, idKey?: string): boolean => {
  const { field, after } = u
  if (answers(u.given, field)) return true
  if (field?.t === 'items' && Array.isArray(after)) {
    const was = Array.isArray(u.before) ? u.before : []
    return after.every((a) => {
      const before = was.find((x) => idOf(field, x) === idOf(field, a))
      const given = itemSaid(u.given, field, a)
      return covers({ field: groupOf(field), before, after: a, given }, field.id)
    })
  }
  if (isObj(after))
    return Object.entries(after).every(
      ([k, a]) =>
        k === idKey ||
        covers({
          field: childField(field, k),
          before: step(u.before, k),
          after: a,
          given: keySaid(u.given, k),
        }),
    )
  return u.given !== UNSAID || !same(u.before, after)
}

type Verdict = { kind: 'answered' } | { kind: 'sample'; path: Path } | { kind: 'kept' }

// Follows a mark's path from the file as it was into the merged value and the input, matching
// items by id. A mark on a whole section stays, and so does one on an exempt value (kept or
// given, such as an id or a name) that the input does not answer: it is the user's own note.
const judge = (path: Path, c: Change & { given: unknown }, root: GroupField): Verdict => {
  let w: Walk | undefined = {
    field: root,
    section: false,
    idKey: undefined,
    before: c.before,
    after: c.after,
    given: c.given,
    out: [],
  }
  for (const key of path) {
    if (answers(w.given, w.field)) return { kind: 'answered' }
    w = walkInto(w, key)
    if (!w) return { kind: 'answered' }
  }
  if (w.section) return { kind: 'kept' }
  if (w.after === undefined) return { kind: 'answered' }
  if (w.given !== UNSAID && covers(w, w.idKey)) return { kind: 'answered' }
  if (w.field?.t !== 'group' && w.field?.kind === 'exempt') return { kind: 'kept' }
  return { kind: 'sample', path: w.out }
}

// No folding, so a long sentence stays on one line and reads back as written.
const OPTIONS = { lineWidth: 0, flowCollectionPadding: false }

// Items are matched by id, so a kept item keeps its node and the comments on it.
const syncItems = (doc: Document, seq: YAMLSeq, field: ItemsField, c: Change) => {
  const before = Array.isArray(c.before) ? c.before : []
  const after = Array.isArray(c.after) ? c.after : []
  const id = (v: unknown) => idOf(field, v)
  const stays = (b: unknown) => after.some((a) => id(a) === id(b))
  const kept = seq.items.filter((_, i) => stays(before[i]))
  const keptBefore = before.filter(stays)
  seq.items = after.map((a) => {
    const i = keptBefore.findIndex((b) => id(b) === id(a))
    if (i === -1) return doc.createNode(a)
    return sync(doc, kept[i], { before: keptBefore[i], after: a }, groupOf(field))
  })
}

const sync = (doc: Document, node: unknown, c: Change, field?: Field): unknown => {
  const { before, after } = c
  if (same(before, after)) return node
  if (isScalar(node) && (after === null || typeof after !== 'object')) {
    node.value = after
    return node
  }
  if (isMap(node) && isObj(before) && isObj(after)) {
    syncMap(doc, node, { before, after }, field)
    return node
  }
  if (isSeq(node) && field?.t === 'items' && Array.isArray(before) && Array.isArray(after)) {
    syncItems(doc, node, field, c)
    return node
  }
  const made = doc.createNode(after)
  // A list or map written inline ([a, b] or {a: 1}) stays inline when replaced.
  if ((isSeq(node) || isMap(node)) && node.flow && (isSeq(made) || isMap(made))) made.flow = true
  return made
}

const syncMap = (doc: Document, map: YAMLMap, c: { before: Obj; after: Obj }, field?: Field) => {
  map.items = map.items.filter((pair) => keyOf(pair) in c.after)
  for (const [key, v] of Object.entries(c.after)) {
    const pair = map.items.find((p) => keyOf(p) === key)
    const change = { before: c.before[key], after: v }
    if (pair) pair.value = sync(doc, pair.value, change, childField(field, key))
    else map.items.push(doc.createPair(key, v))
  }
}

const eachCommented = (doc: Document, act: (c: Commented) => void) => {
  act(doc)
  visit(doc, (_, node) => {
    if (isPair(node)) {
      if (isNode(node.key)) act(node.key)
    } else if (isNode(node)) act(node)
  })
}

// Only the marks a draft answers, and the header's, are taken out of an existing file; a mark
// still on a sample refuses the draft, and any other is the user's note and stays.
export const yamlText = (
  source: string,
  fresh: boolean,
  change: { before: Obj; after: Obj; given: Obj },
  root: GroupField,
): { text: string; marked: Path[]; stripped: boolean } => {
  const doc: Document = parseDocument(source)
  const marks = fresh ? [] : findMarks(doc)
  if (fresh)
    eachCommented(doc, (c) => {
      c.comment = null
      c.commentBefore = null
    })
  const left: Path[] = []
  let stripped = false
  for (const mark of marks) {
    const verdict = mark.header ? { kind: 'answered' as const } : judge(mark.path, change, root)
    if (verdict.kind === 'sample') left.push(verdict.path)
    if (verdict.kind !== 'answered') continue
    stripped = mark.clear() || stripped
  }
  // Every table's root is a map, and so is every file read through one.
  if (isMap(doc.contents)) syncMap(doc, doc.contents, change, root)
  else doc.contents = doc.createNode(change.after)
  return { text: doc.toString(OPTIONS), marked: left, stripped }
}
