// Where Drafts wait for the user's yes: .coach/drafts/<file> holds the exact text, and
// <file>.draft.json when it was made and what the target held then. Writing a draft is refused
// for a target that changed since, and undone when the record check finds an error the write
// brought in, so a profile still being set up can be written one file at a time.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { error, type Problem } from './problem.ts'
import { describe } from './read-file.ts'
import { LOCAL_DIR } from './update.ts'
import type { Workspace } from './workspace.ts'

export const DRAFTS = join(LOCAL_DIR, 'drafts')

export type Open = (root: string) => Workspace

type Meta = { made: string; base: string | null }

const hash = (text: string | undefined) =>
  text === undefined ? null : createHash('sha256').update(text).digest('hex')
export const readIfThere = (path: string) =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined
const paths = (root: string, file: string) => ({
  target: join(root, file),
  text: join(root, DRAFTS, file),
  meta: join(root, DRAFTS, `${file}.draft.json`),
})

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export const keepDraft = (root: string, file: string, text: string, now: Date) => {
  const p = paths(root, file)
  const meta: Meta = { made: now.toISOString(), base: hash(readIfThere(p.target)) }
  put(p.text, text)
  put(p.meta, `${JSON.stringify(meta)}\n`)
}

const readMeta = (path: string): Meta | undefined => {
  try {
    const m: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof m !== 'object' || m === null || !('made' in m) || !('base' in m)) return undefined
    const { made, base } = m
    if (typeof made === 'string' && (base === null || typeof base === 'string'))
      return { made, base }
  } catch {
    // A note that cannot be read leaves nothing to compare the target with, so no draft.
  }
  return undefined
}

const noDraft = (file: string) => error(file, 'has no draft waiting')

export type WriteResult =
  | { kind: 'missing'; problems: Problem[] }
  | { kind: 'stale'; problems: Problem[] }
  | { kind: 'restored'; problems: Problem[] }
  | { kind: 'written'; files: string[] }

type Pending = { file: string; p: ReturnType<typeof paths>; text: string; old: string | undefined }

const pending = (root: string, files: string[]) => {
  const missing: Problem[] = []
  const stale: Problem[] = []
  const drafts: Pending[] = []
  for (const file of files) {
    const p = paths(root, file)
    const meta = readMeta(p.meta)
    const text = readIfThere(p.text)
    const old = readIfThere(p.target)
    if (!meta || text === undefined) missing.push(noDraft(file))
    else if (hash(old) !== meta.base)
      stale.push(
        error(
          file,
          'changed after its draft was made, so nothing was written; make the draft again',
        ),
      )
    else drafts.push({ file, p, text, old })
  }
  return { missing, stale, drafts }
}

const putBack = (drafts: Pending[]) => {
  for (const d of drafts)
    if (d.old === undefined) rmSync(d.p.target, { force: true })
    else put(d.p.target, d.old)
}

const errorKey = (p: Problem) => `${p.slug}\n${p.message}`

// Writes every named draft or none of them.
export const writeDrafts = (root: string, files: string[], open: Open): WriteResult => {
  const { missing, stale, drafts } = pending(root, files)
  if (missing.length > 0) return { kind: 'missing', problems: missing }
  if (stale.length > 0) return { kind: 'stale', problems: stale }
  const before = new Set(open(root).check().problems.map(errorKey))
  for (const d of drafts)
    try {
      put(d.p.target, d.text)
    } catch (e) {
      putBack(drafts)
      return { kind: 'restored', problems: [error(d.file, `could not be written: ${describe(e)}`)] }
    }
  const brought = open(root)
    .check()
    .problems.filter((x) => x.level === 'error' && !before.has(errorKey(x)))
  if (brought.length > 0) {
    putBack(drafts)
    return { kind: 'restored', problems: brought }
  }
  for (const d of drafts) {
    rmSync(d.p.text, { force: true })
    rmSync(d.p.meta, { force: true })
  }
  return { kind: 'written', files }
}

export const dropDrafts = (root: string, files: string[]): Problem[] =>
  files.flatMap((file) => {
    const p = paths(root, file)
    if (!existsSync(p.meta)) return [noDraft(file)]
    rmSync(p.text, { force: true })
    rmSync(p.meta, { force: true })
    return []
  })

const metaFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return metaFiles(join(dir, e.name))
    return e.name.endsWith('.draft.json') ? [join(dir, e.name)] : []
  })
}

export const listDrafts = (root: string): { file: string; made: Date }[] =>
  metaFiles(join(root, DRAFTS)).flatMap((path) => {
    const meta = readMeta(path)
    const file = relative(join(root, DRAFTS), path).replace(/\.draft\.json$/, '')
    return meta ? [{ file, made: new Date(meta.made) }] : []
  })
