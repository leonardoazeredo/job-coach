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
  parseDocument,
  visit,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'
import type { Field, GroupField, ItemsField } from './draft-fields.ts'
import {
  type Change,
  type Commented,
  childField,
  findMarks,
  judge,
  keyOf,
  type Path,
  same,
} from './draft-marks.ts'
import { idOf, isObj, itemGroup, type Obj } from './draft-merge.ts'

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
    return sync(doc, kept[i], { before: keptBefore[i], after: a }, itemGroup(field))
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
