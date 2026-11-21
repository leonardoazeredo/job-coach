import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { clashKinds, finishUpdate, takeSide } from '../lib/update-git.ts'
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
