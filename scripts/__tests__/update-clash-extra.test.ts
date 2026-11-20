import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clashKinds, finishUpdate, takeSide } from '../lib/update-git.ts'
import { engineWrite, link, seen, start, userLink } from './update-clash-helpers.ts'
import {
  cloned,
  commitAll,
  g,
  put,
  runner,
  templated,
  upstream,
  userCommit,
  work,
} from './update-helpers.ts'

const files = (...rels: string[]) => Object.fromEntries(rels.map((rel) => [rel, seen(rel)]))

// The user's folder holds files git does not track; one of them is ignored, as an exported PDF is.
const userDirVsEngineFile = () => {
  cloned({ x: 'one\n' })
  userCommit({ '.gitignore': '*.pdf\n' }, 'Saved: ignore')
  g(work(), 'rm', '-q', 'x')
  userCommit({ 'x/m.md': 'mine\n' }, 'Saved: folder')
  put(work(), { 'x/notes.txt': 'unsaved\n', 'x/cv.pdf': 'pdf\n' })
  engineWrite({ x: 'new\n' })
  return start().git
}
const engineDirVsUserFile = () => {
  cloned({})
  userCommit({ x: 'mine\n' }, 'Saved')
  engineWrite({ 'x/y.md': 'new\n' })
  const { git } = start()
  put(work(), { 'x/scratch.txt': 'stray\n' })
  return git
}

describe('a take that would delete files git does not keep', () => {
  it("refuses to put the new version's file over a folder holding untracked and ignored files", () => {
    const git = userDirVsEngineFile()
    const before = files('x', 'x/m.md', 'x/notes.txt', 'x/cv.pdf', 'x~origin_main')
    expect(takeSide(git, 'theirs', 'x~origin_main')).toEqual({
      kind: 'in-the-way',
      files: ['x/cv.pdf', 'x/notes.txt'],
    })
    expect(files('x', 'x/m.md', 'x/notes.txt', 'x/cv.pdf', 'x~origin_main')).toEqual(before)
    expect(before['x/cv.pdf']).toBe('pdf\n')
    expect(clashKinds(git, work()).get('x~origin_main')).toBe('other')
  })

  it('keeps the folder when the user takes the side that keeps it', () => {
    const git = userDirVsEngineFile()
    expect(takeSide(git, 'ours', 'x~origin_main')).toEqual({ kind: 'taken', left: [] })
    expect(files('x', 'x/m.md', 'x/notes.txt', 'x/cv.pdf', 'x~origin_main')).toEqual({
      x: 'dir',
      'x/m.md': 'mine\n',
      'x/notes.txt': 'unsaved\n',
      'x/cv.pdf': 'pdf\n',
      'x~origin_main': null,
    })
  })

  it("refuses to put the user's file over a folder holding a stray file", () => {
    const git = engineDirVsUserFile()
    expect(takeSide(git, 'ours', 'x~HEAD')).toEqual({
      kind: 'in-the-way',
      files: ['x/scratch.txt'],
    })
    expect(files('x', 'x/y.md', 'x/scratch.txt', 'x~HEAD')).toEqual({
      x: 'dir',
      'x/y.md': 'new\n',
      'x/scratch.txt': 'stray\n',
      'x~HEAD': 'mine\n',
    })
  })

  it("keeps the engine's folder when the user takes theirs", () => {
    const git = engineDirVsUserFile()
    expect(takeSide(git, 'theirs', 'x~HEAD')).toEqual({ kind: 'taken', left: [] })
    expect(files('x', 'x/y.md', 'x/scratch.txt', 'x~HEAD')).toEqual({
      x: 'dir',
      'x/y.md': 'new\n',
      'x/scratch.txt': 'stray\n',
      'x~HEAD': null,
    })
  })
})

describe('one merge holding several kinds of clash', () => {
  it('waits on every kind but the text settled by hand, and takes each as chosen', () => {
    cloned({
      'docs/a.md': 'one\n',
      'docs/b.md': 'one\n',
      t1: 'target\n',
      'assets/logo.bin': 'a\0base\n',
    })
    userCommit({ 'docs/a.md': 'mine\n', 'assets/logo.bin': 'a\0mine\n' }, 'Saved')
    userLink('docs/b.md', '../t1')
    engineWrite({ 'docs/a.md': 'new\n', 'docs/b.md': 'new\n', 'assets/logo.bin': 'a\0new\n' })
    const { git, merged } = start()
    expect(merged).toMatchObject({ kind: 'clashes' })
    writeFileSync(join(work(), 'docs/a.md'), 'both\n')
    const { run } = runner()
    const waiting = finishUpdate(work(), git, { run })
    expect(waiting.kind).toBe('clashes')
    expect(waiting.kind === 'clashes' ? [...waiting.files].sort() : []).toEqual([
      'assets/logo.bin',
      'docs/b.md',
      'docs/b.md~origin_main',
    ])
    expect(takeSide(git, 'theirs', 'docs/b.md')).toEqual({
      kind: 'taken',
      // The hand-settled text file stays listed until finish stages it.
      left: ['assets/logo.bin', 'docs/a.md'],
    })
    expect(takeSide(git, 'ours', 'assets/logo.bin')).toEqual({
      kind: 'taken',
      left: ['docs/a.md'],
    })
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(
      files('docs/a.md', 'docs/b.md', 'docs/b.md~origin_main', 'assets/logo.bin', 't1'),
    ).toEqual({
      'docs/a.md': 'both\n',
      'docs/b.md': 'new\n',
      'docs/b.md~origin_main': null,
      'assets/logo.bin': 'a\0mine\n',
      t1: 'target\n',
    })
  })
})

describe('a link on a first update, with no shared history', () => {
  const setup = (userChanges: boolean) => {
    templated()
    const targets = { t1: 'one\n', t2: 'two\n', t3: 'three\n' }
    put(upstream(), targets)
    link(upstream(), 'ln', 't1')
    commitAll(upstream(), 'Link')
    // The copy's first commit holds the link, so a first update can tell who changed it.
    put(work(), targets)
    link(work(), 'ln', 't1')
    g(work(), 'add', '-A')
    g(work(), 'commit', '-q', '--amend', '--no-edit')
    if (userChanges) {
      link(work(), 'ln', 't2')
      commitAll(work(), 'Saved: new link')
    }
    link(upstream(), 'ln', 't3')
    commitAll(upstream(), 'New link target')
  }

  it('waits for a choice on a link both sides changed, and writes nothing through it', () => {
    setup(true)
    const { git, merged } = start()
    expect(merged).toMatchObject({ kind: 'clashes', files: ['ln'] })
    expect(clashKinds(git, work()).get('ln')).toBe('other')
    expect(files('ln', 't2', 't3')).toEqual({ ln: '-> t2', t2: 'two\n', t3: 'three\n' })
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({
      kind: 'clashes',
      files: ['ln'],
    })
    expect(takeSide(git, 'theirs', 'ln')).toEqual({ kind: 'taken', left: [] })
    expect(seen('ln')).toBe('-> t3')
  })

  it("gives the engine's target without asking when only the engine changed the link", () => {
    setup(false)
    const { merged } = start()
    expect(merged).toEqual({ kind: 'merged' })
    expect(seen('ln')).toBe('-> t3')
  })
})
