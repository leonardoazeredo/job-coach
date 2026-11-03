// Turns a merged value back into YAML text by editing the document it came from, so the
// comments a user wrote in their own file survive and every key keeps its place. A new file
// starts from the template's document with all of its comments taken out.
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
import type { Field, GroupField, ItemsField } from './draft-fields.ts'
import { entryGroup, fieldIn, idOf, isObj, itemGroup, type Obj } from './draft-merge.ts'
import { PLACEHOLDER } from './onboarding.ts'

// No folding, so a long sentence stays on one line and reads back as written.
const OPTIONS = { lineWidth: 0, flowCollectionPadding: false }

type Commented = { comment?: string | null; commentBefore?: string | null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const keyOf = (pair: Pair): string => String(isScalar(pair.key) ? pair.key.value : pair.key)
const marked = (c: string | null | undefined) => c?.includes(PLACEHOLDER) === true

// Template comments name the placeholder; a value set over one drops it, the rest stay.
const unmark = (node: Commented) => {
  if (marked(node.comment)) node.comment = null
  if (marked(node.commentBefore)) node.commentBefore = null
}

const childField = (field: Field | undefined, key: string): Field | undefined => {
  if (field?.t === 'group') return fieldIn(field.fields, key)
  if (field?.t === 'entries') return entryGroup(field)
  return undefined
}

type Change = { before: unknown; after: unknown }

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
    return sync(doc, kept[i], { before: keptBefore[i], after: a }, itemGroup(field))
  })
}

const sync = (doc: Document, node: unknown, c: Change, field?: Field): unknown => {
  const { before, after } = c
  if (same(before, after)) return node
  if (isScalar(node) && (after === null || typeof after !== 'object')) {
    node.value = after
    unmark(node)
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

type Path = (string | number)[]

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

// Every value a template mark sits on, beside it or on the line above, on the value itself,
// on a list or map, or on its key. A mark on the whole document is its header.
const markedPaths = (doc: Document): Path[] => {
  const found: Path[] = []
  visit(doc, (_, node, ancestors) => {
    if (!isNode(node) || !(marked(node.comment) || marked(node.commentBefore))) return
    const path = pathTo(node, ancestors)
    if (path.length > 0) found.push(path)
  })
  return found
}

const step = (v: unknown, key: string | number): unknown => {
  if (Array.isArray(v)) return v[Number(key)]
  return isObj(v) ? v[String(key)] : undefined
}

// Follows a path read in the file as it was into the merged value, matching items by id, and
// gives it back in the merged value's terms when the draft leaves that value as it was.
const untouched = (path: Path, c: Change, root: GroupField): Path | undefined => {
  let field: Field | undefined = root
  let { before, after } = c
  const out: Path = []
  for (const key of path) {
    if (field?.t === 'items' && Array.isArray(before) && Array.isArray(after)) {
      const items: ItemsField = field
      const item = before[Number(key)]
      const at = after.findIndex((x) => idOf(items, x) === idOf(items, item))
      if (at === -1) return undefined
      out.push(at)
      before = item
      after = after[at]
      field = itemGroup(items)
      continue
    }
    out.push(key)
    before = step(before, key)
    after = step(after, key)
    field = childField(field, String(key))
  }
  return after !== undefined && same(before, after) ? out : undefined
}

export const yamlText = (
  source: string,
  fresh: boolean,
  change: { before: Obj; after: Obj },
  root: GroupField,
): { text: string; marked: (string | number)[][] } => {
  const doc: Document = parseDocument(source)
  const marks = fresh ? [] : markedPaths(doc)
  if (fresh)
    eachCommented(doc, (c) => {
      c.comment = null
      c.commentBefore = null
    })
  // Every table's root is a map, and so is every file read through one.
  if (isMap(doc.contents)) syncMap(doc, doc.contents, change, root)
  else doc.contents = doc.createNode(change.after)
  const left = marks.flatMap((path) => {
    const kept = untouched(path, change, root)
    return kept ? [kept] : []
  })
  eachCommented(doc, unmark)
  return { text: doc.toString(OPTIONS), marked: left }
}
