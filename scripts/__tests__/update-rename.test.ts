import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { clashKinds, finishUpdate, renamesOf, takeSide } from '../lib/update-git.ts'
import { updateCommand } from '../update.ts'
import { commitEngine, start } from './update-clash-helpers.ts'
import { cloned, g, runner, upstream, userCommit, work } from './update-helpers.ts'

const BASE = Array.from({ length: 12 }, (_, i) => `line ${i + 1}\n`).join('')
const edited = (text: string, line: number, to: string) => text.replace(`line ${line}\n`, `${to}\n`)

const A = 'docs/a.md'
const B = 'docs/b.md'
const C = 'docs/c.md'

// The user renames docs/a.md to docs/b.md and the new version renames it to docs/c.md; either side
// may also have changed the text, given as what that side's file holds.
const renamedOnBothSides = (user = BASE, engine = BASE) => {
  cloned({ [A]: BASE })
  g(work(), 'mv', A, B)
  userCommit({ [B]: user }, 'Saved: rename')
  g(upstream(), 'mv', A, C)
  writeFileSync(join(upstream(), C), engine)
  commitEngine('Rename')
}

const onDisk = () =>
  Object.fromEntries(
    [A, B, C].map((rel) => {
      const path = join(work(), rel)
      return [rel, existsSync(path) ? readFileSync(path, 'utf8') : null]
    }),
  )

describe('a file both sides renamed', () => {
  it('judges all three paths as one rename and reports both new names', () => {
    renamedOnBothSides()
    const { git, merged } = start()
    expect(Object.fromEntries(clashKinds(git, work()))).toEqual({
      [A]: 'renamed',
      [B]: 'renamed',
      [C]: 'renamed',
    })
    expect(merged).toMatchObject({
      kind: 'clashes',
      renames: [{ base: A, ours: B, theirs: C, contentClash: false }],
    })
  })

  it('waits for the choice when finished first, and changes nothing', () => {
    renamedOnBothSides()
    const { git } = start()
    const before = onDisk()
    expect(finishUpdate(work(), git, { run: runner().run })).toMatchObject({
      kind: 'clashes',
      files: [A, B, C],
    })
    expect(onDisk()).toEqual(before)
  })

  for (const side of ['ours', 'theirs'] as const) {
    for (const asked of [A, B, C]) {
      it(`keeps only the ${side} name when ${side} is taken by ${asked}`, () => {
        renamedOnBothSides()
        const { git } = start()
        expect(takeSide(git, side, asked)).toEqual({ kind: 'taken', left: [] })
        expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
        expect(onDisk()).toEqual({
          [A]: null,
          [B]: side === 'ours' ? BASE : null,
          [C]: side === 'theirs' ? BASE : null,
        })
      })
    }
  }

  it('keeps the edits of both sides when they changed different lines', () => {
    renamedOnBothSides(edited(BASE, 2, 'mine'), edited(BASE, 10, 'new'))
    const { git, merged } = start()
    expect(merged).toMatchObject({ renames: [{ contentClash: false }] })
    takeSide(git, 'theirs', B)
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(edited(edited(BASE, 2, 'mine'), 10, 'new'))
  })

  describe('when both sides also changed the same line', () => {
    const user = edited(BASE, 5, 'mine')
    const engine = edited(BASE, 5, 'new')

    for (const [side, name, content] of [
      ['ours', B, user],
      ['theirs', C, engine],
    ] as const) {
      it(`reports the content clash and keeps the ${side} file whole, with no markers`, () => {
        renamedOnBothSides(user, engine)
        const { git, merged } = start()
        expect(merged).toMatchObject({ renames: [{ contentClash: true }] })
        expect(takeSide(git, side, A)).toEqual({ kind: 'taken', left: [] })
        expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
        expect(onDisk()).toEqual({ [A]: null, [B]: null, [C]: null, [name]: content })
      })
    }
  })

  it('does not take a Markdown heading underline for a clash marker', () => {
    const titled = `Title\n=======\n\n${BASE}`
    cloned({ [A]: titled })
    g(work(), 'mv', A, B)
    userCommit({ [B]: edited(titled, 2, 'mine') }, 'Saved: rename')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), C), edited(titled, 10, 'new'))
    commitEngine('Rename')
    const { git } = start()
    expect(renamesOf(git)).toMatchObject([{ contentClash: false }])
    takeSide(git, 'theirs', A)
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(edited(edited(titled, 2, 'mine'), 10, 'new'))
  })

  it('does not take a sample clash block in the file itself for a clash', () => {
    const sample = `<<<<<<< yours\nx\n=======\ny\n>>>>>>> new version\n${BASE}`
    cloned({ [A]: sample })
    g(work(), 'mv', A, B)
    userCommit({ [B]: edited(sample, 2, 'mine') }, 'Saved: rename')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), C), edited(sample, 10, 'new'))
    commitEngine('Rename')
    const { git } = start()
    expect(renamesOf(git)).toMatchObject([{ contentClash: false }])
    takeSide(git, 'theirs', A)
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(edited(edited(sample, 2, 'mine'), 10, 'new'))
  })

  it('leaves another clash waiting when the rename is taken', () => {
    cloned({ [A]: BASE, 'docs/x.md': 'one\n' })
    g(work(), 'mv', A, B)
    userCommit({ [B]: BASE, 'docs/x.md': 'mine\n' }, 'Saved')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), 'docs/x.md'), 'new\n')
    commitEngine('Rename and change')
    const { git } = start()
    expect(takeSide(git, 'ours', C)).toMatchObject({ kind: 'taken', left: ['docs/x.md'] })
    expect(finishUpdate(work(), git, { run: runner().run })).toMatchObject({
      kind: 'clashes',
      files: ['docs/x.md'],
    })
  })

  it('does not take a marker-like line a side added for a clash', () => {
    const user = edited(BASE, 2, 'mine')
    const engine = edited(BASE, 10, '<<<<<<< example of a clash')
    renamedOnBothSides(user, engine)
    const { git } = start()
    expect(renamesOf(git)).toMatchObject([{ contentClash: false }])
    takeSide(git, 'theirs', A)
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(edited(user, 10, '<<<<<<< example of a clash'))
  })

  it('still sees a clash when a side removed the sample block the base held', () => {
    const sample = `<<<<<<< yours\nx\n=======\ny\n>>>>>>> new version\n${BASE}`
    const engine = edited(sample, 5, 'new')
    cloned({ [A]: sample })
    g(work(), 'mv', A, B)
    userCommit({ [B]: edited(BASE, 5, 'mine') }, 'Saved: rename')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), C), engine)
    commitEngine('Rename')
    const { git } = start()
    expect(renamesOf(git)).toMatchObject([{ contentClash: true }])
    expect(takeSide(git, 'theirs', A)).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(engine)
  })

  it('sees the clash git left even when another diff algorithm would merge it cleanly', () => {
    const base = '{\n}\nx\nb\n{\n}\nb\n'
    const user = '\n{\n}\nb\nb\n}\n}\nb\n'
    const engine = '{\n}\nx\nb\n{\n}\nb\nx\n'
    cloned({ [A]: base })
    g(work(), 'mv', A, B)
    userCommit({ [B]: user }, 'Saved: rename')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), C), engine)
    commitEngine('Rename')
    const { git } = start()
    expect(renamesOf(git)).toMatchObject([{ contentClash: true }])
    takeSide(git, 'theirs', A)
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(engine)
  })

  describe('when the folder no longer shows the clash that git staged', () => {
    const user = edited(BASE, 5, 'mine')
    const engine = edited(BASE, 5, 'new')
    const settled = {
      'hand-edited': () => {
        writeFileSync(join(work(), B), BASE)
        writeFileSync(join(work(), C), BASE)
      },
      deleted: () => {
        rmSync(join(work(), B))
        rmSync(join(work(), C))
      },
    }
    for (const [how, change] of Object.entries(settled)) {
      for (const [side, name, content] of [
        ['ours', B, user],
        ['theirs', C, engine],
      ] as const) {
        it(`still judges the content as clashing and keeps the ${side} file whole when the files were ${how}`, () => {
          renamedOnBothSides(user, engine)
          const { git } = start()
          change()
          expect(renamesOf(git)).toMatchObject([{ contentClash: true }])
          expect(takeSide(git, side, B)).toEqual({ kind: 'taken', left: [] })
          expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
          expect(onDisk()).toEqual({ [A]: null, [B]: null, [C]: null, [name]: content })
        })
      }
    }
  })

  it('says in the rename line when the content clashes too', async () => {
    renamedOnBothSides(edited(BASE, 5, 'mine'), edited(BASE, 5, 'new'))
    const lines: unknown[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
    const deps = { engineUrl: upstream(), run: runner().run }
    await updateCommand(['changes'], work(), deps)
    lines.length = 0
    await updateCommand(['merge'], work(), deps)
    log.mockRestore()
    expect(lines).toEqual([
      `clashes: ${A}, ${B}, ${C}`,
      `- renamed ${A}: yours ${B}, new version ${C}; the content clashes too`,
    ])
  })

  it('keeps one side whole when a binary file renamed on both sides was also changed', () => {
    const bin = (tail: string) => `\0${BASE}${tail}\n`
    cloned({ [A]: bin('base') })
    g(work(), 'mv', A, B)
    userCommit({ [B]: bin('mine') }, 'Saved: rename')
    g(upstream(), 'mv', A, C)
    writeFileSync(join(upstream(), C), bin('new'))
    commitEngine('Rename')
    const { git } = start()
    expect(renamesOf(git)).toMatchObject([{ contentClash: true }])
    expect(takeSide(git, 'theirs', B)).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()).toEqual({ [A]: null, [B]: null, [C]: bin('new') })
  })

  it('names both new paths in the merge, take and finish lines', async () => {
    renamedOnBothSides()
    const lines: unknown[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
    const run = runner().run
    const deps = { engineUrl: upstream(), run }
    await updateCommand(['changes'], work(), deps)
    lines.length = 0
    expect(await updateCommand(['merge'], work(), deps)).toBe(0)
    expect(await updateCommand(['finish'], work(), deps)).toBe(EXIT.problems)
    expect(await updateCommand(['take', 'theirs', B], work(), deps)).toBe(0)
    log.mockRestore()
    const renamed = `- renamed ${A}: yours ${B}, new version ${C}`
    expect(lines).toEqual([
      `clashes: ${A}, ${B}, ${C}`,
      renamed,
      `clashes left: ${A}, ${B}, ${C}`,
      renamed,
      `taken: ${B}; no clashes left`,
    ])
  })
})
