import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type ClashKind, clashKinds, finishUpdate, takeSide } from '../lib/update-git.ts'
import {
  commitEngine,
  engineLink,
  engineRemove,
  engineWrite,
  link,
  type Seen,
  seen,
  start,
  userLink,
  userRemove,
} from './update-clash-helpers.ts'
import { cloned, g, read, runner, upstream, userCommit, work } from './update-helpers.ts'

type Row = {
  name: string
  base: Record<string, string>
  // Links the base already holds, as path to target.
  links?: Record<string, string>
  user: () => void
  engine: () => void
  // Every unmerged path and the kind it is judged to be.
  kinds: Record<string, ClashKind>
  // The path the user is asked about and takes.
  take: string
  ours: Seen
  theirs: Seen
}

const TARGETS = { t1: 'one\n', t2: 'two\n', t3: 'three\n' }

const rows: Row[] = [
  {
    name: 'a file the user changed and the engine removed',
    base: { 'docs/a.md': 'one\n' },
    user: () => userCommit({ 'docs/a.md': 'mine\n' }, 'Saved'),
    engine: () => engineRemove('docs/a.md'),
    kinds: { 'docs/a.md': 'one-sided' },
    take: 'docs/a.md',
    ours: { 'docs/a.md': 'mine\n' },
    theirs: { 'docs/a.md': null },
  },
  {
    name: 'a file the user removed and the engine changed',
    base: { 'docs/a.md': 'one\n' },
    user: () => userRemove('docs/a.md'),
    engine: () => engineWrite({ 'docs/a.md': 'new\n' }),
    kinds: { 'docs/a.md': 'one-sided' },
    take: 'docs/a.md',
    ours: { 'docs/a.md': null },
    theirs: { 'docs/a.md': 'new\n' },
  },
  {
    name: 'a file the user removed and the engine renamed',
    base: { 'docs/a.md': 'one\n' },
    user: () => userRemove('docs/a.md'),
    engine: () => {
      g(upstream(), 'mv', 'docs/a.md', 'docs/b.md')
      commitEngine('Rename')
    },
    kinds: { 'docs/b.md': 'one-sided' },
    take: 'docs/b.md',
    ours: { 'docs/a.md': null, 'docs/b.md': null },
    theirs: { 'docs/a.md': null, 'docs/b.md': 'one\n' },
  },
  {
    name: 'a binary file both sides changed',
    base: { 'assets/logo.bin': 'a\0base\n' },
    user: () => userCommit({ 'assets/logo.bin': 'a\0mine\n' }, 'Saved'),
    engine: () => engineWrite({ 'assets/logo.bin': 'a\0new\n' }),
    kinds: { 'assets/logo.bin': 'binary' },
    take: 'assets/logo.bin',
    ours: { 'assets/logo.bin': 'a\0mine\n' },
    theirs: { 'assets/logo.bin': 'a\0new\n' },
  },
  {
    name: 'a binary file both sides added',
    base: {},
    user: () => userCommit({ 'assets/logo.bin': 'a\0mine\n' }, 'Saved'),
    engine: () => engineWrite({ 'assets/logo.bin': 'a\0new\n' }),
    kinds: { 'assets/logo.bin': 'binary' },
    take: 'assets/logo.bin',
    ours: { 'assets/logo.bin': 'a\0mine\n' },
    theirs: { 'assets/logo.bin': 'a\0new\n' },
  },
  {
    name: 'a binary file the user changed and the engine removed',
    base: { 'assets/logo.bin': 'a\0base\n' },
    user: () => userCommit({ 'assets/logo.bin': 'a\0mine\n' }, 'Saved'),
    engine: () => engineRemove('assets/logo.bin'),
    kinds: { 'assets/logo.bin': 'one-sided' },
    take: 'assets/logo.bin',
    ours: { 'assets/logo.bin': 'a\0mine\n' },
    theirs: { 'assets/logo.bin': null },
  },
  {
    name: 'a text file both sides changed',
    base: { 'docs/a.md': 'one\n' },
    user: () => userCommit({ 'docs/a.md': 'mine\n' }, 'Saved'),
    engine: () => engineWrite({ 'docs/a.md': 'new\n' }),
    kinds: { 'docs/a.md': 'text-open' },
    take: 'docs/a.md',
    ours: { 'docs/a.md': 'mine\n' },
    theirs: { 'docs/a.md': 'new\n' },
  },
  {
    name: 'a text file both sides added',
    base: {},
    user: () => userCommit({ 'docs/a.md': 'mine\n' }, 'Saved'),
    engine: () => engineWrite({ 'docs/a.md': 'new\n' }),
    kinds: { 'docs/a.md': 'text-open' },
    take: 'docs/a.md',
    ours: { 'docs/a.md': 'mine\n' },
    theirs: { 'docs/a.md': 'new\n' },
  },
  {
    name: 'a link both sides changed',
    base: TARGETS,
    links: { ln: 't1' },
    user: () => userLink('ln', 't2'),
    engine: () => engineLink('ln', 't3'),
    kinds: { ln: 'other' },
    take: 'ln',
    // The targets stay as they were: no marker is written through the link.
    ours: { ln: '-> t2', ...TARGETS },
    theirs: { ln: '-> t3', ...TARGETS },
  },
  {
    name: 'a link both sides added',
    base: TARGETS,
    user: () => userLink('ln', 't2'),
    engine: () => engineLink('ln', 't3'),
    kinds: { ln: 'other' },
    take: 'ln',
    ours: { ln: '-> t2', ...TARGETS },
    theirs: { ln: '-> t3', ...TARGETS },
  },
  {
    name: 'a file the user made a link and the engine changed',
    base: { ...TARGETS, 'docs/a.md': 'one\n' },
    user: () => userLink('docs/a.md', '../t1'),
    engine: () => engineWrite({ 'docs/a.md': 'new\n' }),
    kinds: { 'docs/a.md': 'other', 'docs/a.md~origin_main': 'other' },
    take: 'docs/a.md',
    ours: { 'docs/a.md': '-> ../t1', 'docs/a.md~origin_main': null },
    theirs: { 'docs/a.md': 'new\n', 'docs/a.md~origin_main': null },
  },
  {
    name: 'a file the user made a link and the engine changed, asked by the parked path',
    base: { ...TARGETS, 'docs/a.md': 'one\n' },
    user: () => userLink('docs/a.md', '../t1'),
    engine: () => engineWrite({ 'docs/a.md': 'new\n' }),
    kinds: { 'docs/a.md': 'other', 'docs/a.md~origin_main': 'other' },
    take: 'docs/a.md~origin_main',
    ours: { 'docs/a.md': '-> ../t1', 'docs/a.md~origin_main': null },
    theirs: { 'docs/a.md': 'new\n', 'docs/a.md~origin_main': null },
  },
  {
    name: 'a file the user changed against a directory of the engine',
    base: { x: 'one\n' },
    user: () => userCommit({ x: 'mine\n' }, 'Saved'),
    engine: () => {
      engineRemove('x')
      engineWrite({ 'x/y.md': 'new\n' })
    },
    kinds: { 'x~HEAD': 'other' },
    take: 'x~HEAD',
    ours: { x: 'mine\n', 'x/y.md': null, 'x~HEAD': null },
    theirs: { x: 'dir', 'x/y.md': 'new\n', 'x~HEAD': null },
  },
  {
    name: 'a file the user added against a directory of the engine',
    base: {},
    user: () => userCommit({ x: 'mine\n' }, 'Saved'),
    engine: () => engineWrite({ 'x/y.md': 'new\n' }),
    kinds: { 'x~HEAD': 'other' },
    take: 'x~HEAD',
    ours: { x: 'mine\n', 'x/y.md': null, 'x~HEAD': null },
    theirs: { x: 'dir', 'x/y.md': 'new\n', 'x~HEAD': null },
  },
  {
    name: 'a directory of the user against a file the engine changed',
    base: { x: 'one\n' },
    user: () => {
      userRemove('x')
      userCommit({ 'x/m.md': 'mine\n' }, 'Saved')
    },
    engine: () => engineWrite({ x: 'new\n' }),
    kinds: { 'x~origin_main': 'other' },
    take: 'x~origin_main',
    ours: { x: 'dir', 'x/m.md': 'mine\n', 'x~origin_main': null },
    theirs: { x: 'new\n', 'x/m.md': null, 'x~origin_main': null },
  },
]

const rowNamed = (name: string): Row => {
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}

const setup = (row: Row) => {
  cloned(row.base)
  if (row.links) {
    // The links are part of what both sides started from.
    for (const [rel, target] of Object.entries(row.links)) {
      link(upstream(), rel, target)
    }
    commitEngine('Links')
    g(work(), 'fetch', '-q', 'origin')
    g(work(), 'merge', '-q', '--no-edit', 'origin/main')
  }
  row.user()
  row.engine()
}

describe('a clashing file by kind', () => {
  for (const row of rows) {
    for (const side of ['ours', 'theirs'] as const) {
      it(`judges ${row.name} and takes ${side} whole`, () => {
        setup(row)
        const { git, merged } = start()
        expect(merged).toMatchObject({ kind: 'clashes' })
        expect(Object.fromEntries(clashKinds(git, work()))).toEqual(row.kinds)
        const { run } = runner()
        // Finishing never chooses: only a file settled by hand goes through.
        expect(finishUpdate(work(), git, { run })).toEqual({
          kind: 'clashes',
          files: Object.keys(row.kinds),
        })
        expect(takeSide(git, side, row.take)).toEqual({ kind: 'taken', left: [] })
        expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
        const expected = row[side]
        expect(Object.fromEntries(Object.keys(expected).map((rel) => [rel, seen(rel)]))).toEqual(
          expected,
        )
      })
    }
  }
})

describe('a clashing file that is not text', () => {
  it('leaves a binary file as git left it, with no clash markers', () => {
    setup(rowNamed('a binary file both sides changed'))
    start()
    expect(read('assets/logo.bin')).toBe('a\0mine\n')
  })

  it('writes no marker through a link into the file it points at', () => {
    setup(rowNamed('a link both sides changed'))
    start()
    expect(seen('t2')).toBe('two\n')
    expect(seen('t3')).toBe('three\n')
    expect(seen('ln')).toBe('-> t2')
  })
})

describe('a text clash settled by hand', () => {
  it('is judged settled once no marker is left, and finishes as it stands', () => {
    setup(rowNamed('a text file both sides changed'))
    const { git } = start()
    expect(clashKinds(git, work()).get('docs/a.md')).toBe('text-open')
    writeFileSync(join(work(), 'docs/a.md'), 'both\n')
    expect(clashKinds(git, work()).get('docs/a.md')).toBe('text-settled')
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(read('docs/a.md')).toBe('both\n')
    expect(existsSync(join(work(), 'docs/a.md'))).toBe(true)
  })
})
