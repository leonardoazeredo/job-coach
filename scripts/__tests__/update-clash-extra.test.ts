import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { clashKinds, finishUpdate, takeSide } from '../lib/update-git.ts'
import { updateCommand } from '../update.ts'
import { engineRemove, engineWrite, link, seen, start, userLink } from './update-clash-helpers.ts'
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
const userDirVsEngineFile = (strays = true) => {
  cloned({ x: 'one\n' })
  userCommit({ '.gitignore': '*.pdf\n' }, 'Saved: ignore')
  g(work(), 'rm', '-q', 'x')
  userCommit({ 'x/m.md': 'mine\n' }, 'Saved: folder')
  if (strays) put(work(), { 'x/notes.txt': 'unsaved\n', 'x/cv.pdf': 'pdf\n' })
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

  it('refuses to delete a saved file whose edits were made after the update started', () => {
    const git = userDirVsEngineFile(false)
    writeFileSync(join(work(), 'x/m.md'), 'edited since\n')
    expect(takeSide(git, 'theirs', 'x~origin_main')).toEqual({
      kind: 'in-the-way',
      files: ['x/m.md'],
    })
    expect(files('x', 'x/m.md', 'x~origin_main')).toEqual({
      x: 'dir',
      'x/m.md': 'edited since\n',
      'x~origin_main': 'new\n',
    })
  })

  it('prints the refusal as one plain line and exits with a problem', async () => {
    userDirVsEngineFile()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = await updateCommand(['take', 'theirs', 'x~origin_main'], work(), {
      engineUrl: upstream(),
      run: runner().run,
    })
    const lines = log.mock.calls.map((c) => c[0])
    log.mockRestore()
    error.mockRestore()
    expect({ code, lines }).toEqual({
      code: EXIT.problems,
      lines: ['not taken: these files are in the way: x/cv.pdf, x/notes.txt; nothing was changed'],
    })
    expect(seen('x/cv.pdf')).toBe('pdf\n')
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

describe('a take discards hand edits to the clashing file itself', () => {
  it.each([
    ['theirs', 'new\n'],
    ['ours', 'mine\n'],
  ] as const)('takes %s over a text clash settled by hand', (side, text) => {
    cloned({ 'docs/a.md': 'one\n' })
    userCommit({ 'docs/a.md': 'mine\n' }, 'Saved')
    engineWrite({ 'docs/a.md': 'new\n' })
    const { git } = start()
    writeFileSync(join(work(), 'docs/a.md'), 'both\n')
    expect(takeSide(git, side, 'docs/a.md')).toEqual({ kind: 'taken', left: [] })
    expect(seen('docs/a.md')).toBe(text)
  })

  it("keeps the user's version of a file the engine removed, though it was edited since", () => {
    cloned({ 'docs/a.md': 'one\n' })
    userCommit({ 'docs/a.md': 'mine\n' }, 'Saved')
    engineRemove('docs/a.md')
    const { git } = start()
    writeFileSync(join(work(), 'docs/a.md'), 'edited since\n')
    expect(takeSide(git, 'ours', 'docs/a.md')).toEqual({ kind: 'taken', left: [] })
    expect(seen('docs/a.md')).toBe('mine\n')
  })

  it('takes the new binary file over one replaced by hand', () => {
    cloned({ 'assets/logo.bin': 'a\0base\n' })
    userCommit({ 'assets/logo.bin': 'a\0mine\n' }, 'Saved')
    engineWrite({ 'assets/logo.bin': 'a\0new\n' })
    const { git } = start()
    writeFileSync(join(work(), 'assets/logo.bin'), 'a\0by hand\n')
    expect(takeSide(git, 'theirs', 'assets/logo.bin')).toEqual({ kind: 'taken', left: [] })
    expect(seen('assets/logo.bin')).toBe('a\0new\n')
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
