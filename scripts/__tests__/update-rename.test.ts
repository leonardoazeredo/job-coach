import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

// Registers the refusal (or the plain take, where the take removes the changed name anyway) and the
// go-on take for one change by hand and one side taken.
const handEditCases = (
  side: 'ours' | 'theirs',
  what: string,
  scene: { setUp: () => void; change: () => void; opts: { text?: 'ours' } },
  refuses: { ours: readonly string[]; theirs: readonly string[] },
) => {
  const { setUp, change, opts } = scene
  const files = refuses[side]
  const kept = side === 'ours' ? B : C
  const state = () => ({
    status: g(work(), 'status', '--short'),
    index: g(work(), 'ls-files', '-s'),
    disk: onDisk(),
  })
  const start1 = () => {
    setUp()
    const { git } = start()
    change()
    return git
  }
  it.runIf(files.length > 0)(
    `refuses the ${side} take and changes nothing when the file is ${what}`,
    () => {
      const git = start1()
      const before = state()
      expect(takeSide(git, side, A, opts)).toEqual({ kind: 'hand-edited', files })
      expect(state()).toEqual(before)
    },
  )
  it.runIf(files.length === 0)(`takes ${side} without refusing when the file is ${what}`, () => {
    const git = start1()
    expect(takeSide(git, side, A, opts)).toEqual({ kind: 'taken', left: [] })
    expect(g(work(), 'ls-files', 'docs').split('\n')).toEqual([kept])
  })
  it(`goes on with the ${side} take when told to, though the file is ${what}`, () => {
    const git = start1()
    expect(takeSide(git, side, A, { ...opts, discardEdits: true })).toEqual({
      kind: 'taken',
      left: [],
    })
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[kept]).not.toBe('EDITED\n')
    expect(g(work(), 'ls-files', 'docs').split('\n')).toEqual([kept])
  })
}

// The user's folder stood at a new name, was emptied as the skill offers and then removed: the
// plain take goes on at the name it does not keep; at the kept name the file it would keep is gone
// and counts as an edit by hand, so it goes on only when told to.
const settleAfterFolder = (
  scene: { setUp: () => void; opts: { text?: 'ours' } },
  side: 'ours' | 'theirs',
  name: string,
) => {
  const { setUp, opts } = scene
  const state = () => ({
    status: g(work(), 'status', '--short'),
    index: g(work(), 'ls-files', '-s'),
    docs: readdirSync(join(work(), 'docs')).sort(),
  })
  setUp()
  const { git } = start()
  rmSync(join(work(), name))
  mkdirSync(join(work(), name))
  writeFileSync(join(work(), name, 'cv.pdf'), 'PDF\n')
  expect(takeSide(git, side, A, opts)).toEqual({ kind: 'in-the-way', files: [`${name}/cv.pdf`] })
  rmSync(join(work(), name, 'cv.pdf'))
  const before = state()
  for (const discardEdits of [false, true])
    expect(takeSide(git, side, A, { ...opts, discardEdits })).toEqual({
      kind: 'in-the-way',
      files: [name],
    })
  expect(state()).toEqual(before)
  rmdirSync(join(work(), name))
  const kept = side === 'ours' ? B : C
  const edits = name === kept ? { ...opts, discardEdits: true } : opts
  if (name === kept)
    expect(takeSide(git, side, A, opts)).toEqual({ kind: 'hand-edited', files: [name] })
  expect(takeSide(git, side, A, edits)).toMatchObject({ kind: 'taken', left: [] })
  expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
  expect(g(work(), 'ls-files', 'docs').split('\n')).toEqual([kept])
  expect(existsSync(join(work(), side === 'ours' ? C : B))).toBe(false)
}

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

    // The name and the text are separate choices, so each name can hold each side's whole file.
    const text = { ours: user, theirs: engine }
    for (const side of ['ours', 'theirs'] as const) {
      for (const version of ['ours', 'theirs'] as const) {
        for (const asked of [A, B, C]) {
          it(`gives the ${side} name the ${version} text when taken by ${asked}, with no markers`, () => {
            renamedOnBothSides(user, engine)
            const { git, merged } = start()
            expect(merged).toMatchObject({ renames: [{ contentClash: true }] })
            expect(takeSide(git, side, asked, { text: version })).toEqual({
              kind: 'taken',
              left: [],
            })
            expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
            expect(onDisk()).toEqual({
              [A]: null,
              [B]: side === 'ours' ? text[version] : null,
              [C]: side === 'theirs' ? text[version] : null,
            })
          })
        }
      }
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
    expect(takeSide(git, 'theirs', A, { text: 'theirs' })).toEqual({ kind: 'taken', left: [] })
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
    takeSide(git, 'theirs', A, { text: 'theirs' })
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
    expect(onDisk()[C]).toBe(engine)
  })

  describe('a binary file renamed on both sides', () => {
    const bin = (tail: string) => `\0${BASE}${tail}`
    const renamedBinary = (user: string, engine: string) => {
      cloned({ [A]: bin('') })
      g(work(), 'mv', A, B)
      userCommit({ [B]: user }, 'Saved: rename')
      g(upstream(), 'mv', A, C)
      writeFileSync(join(upstream(), C), engine)
      commitEngine('Rename')
      return start().git
    }

    it('is no content clash when neither side changed it', () => {
      const git = renamedBinary(bin(''), bin(''))
      expect(renamesOf(git)).toMatchObject([{ contentClash: false }])
    })

    for (const [side, name] of [
      ['ours', B],
      ['theirs', C],
    ] as const) {
      it(`keeps the only change made when the ${side} name is taken`, () => {
        const git = renamedBinary(bin(''), bin('new'))
        expect(renamesOf(git)).toMatchObject([{ contentClash: false }])
        takeSide(git, side, A)
        expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
        expect(onDisk()[name]).toBe(bin('new'))
      })
    }
  })

  it('holds two renames at once and settles them one at a time', () => {
    cloned({ [A]: BASE, 'docs/d.md': `${BASE}d\n` })
    g(work(), 'mv', A, B)
    g(work(), 'mv', 'docs/d.md', 'docs/e.md')
    userCommit({}, 'Saved: renames')
    g(upstream(), 'mv', A, C)
    g(upstream(), 'mv', 'docs/d.md', 'docs/f.md')
    commitEngine('Renames')
    const { git, merged } = start()
    expect(merged).toMatchObject({ renames: [{ base: A }, { base: 'docs/d.md' }] })
    const taken = takeSide(git, 'ours', A)
    expect(taken).toMatchObject({ kind: 'taken', renames: [{ base: 'docs/d.md' }] })
    expect(takeSide(git, 'theirs', 'docs/e.md')).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
  })

  for (const [side, name] of [
    ['ours', B],
    ['theirs', C],
  ] as const) {
    for (const [file, how] of [
      [A, 'at the old name'],
      ['docs/A.md', 'at the old name in other capitals'],
      ['docs/notes.md', 'beside the new names'],
    ] as const) {
      it(`keeps an unsaved file ${how} when ${side} is taken`, () => {
        renamedOnBothSides()
        const { git } = start()
        writeFileSync(join(work(), file), 'MY NOTES\n')
        expect(takeSide(git, side, B)).toEqual({ kind: 'taken', left: [] })
        expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
        expect(readFileSync(join(work(), file), 'utf8')).toBe('MY NOTES\n')
        expect(g(work(), 'ls-files', 'docs').split('\n')).toEqual([name])
      })
    }
  }

  for (const side of ['ours', 'theirs'] as const) {
    it(`takes ${side} when one name differs from the old one only in capitals`, () => {
      cloned({ [A]: BASE })
      g(work(), 'mv', A, 'docs/tmp.md')
      g(work(), 'mv', 'docs/tmp.md', 'docs/A.md')
      userCommit({}, 'Saved: rename')
      g(upstream(), 'mv', A, C)
      commitEngine('Rename')
      const { git } = start()
      expect(takeSide(git, side, A)).toEqual({ kind: 'taken', left: [] })
      expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
      expect(g(work(), 'ls-files', 'docs').split('\n')).toEqual([side === 'ours' ? 'docs/A.md' : C])
      // The folder, not only the index: the file stands under the chosen name and nowhere else.
      expect(readdirSync(join(work(), 'docs'))).toEqual([side === 'ours' ? 'A.md' : 'c.md'])
      expect(readFileSync(join(work(), side === 'ours' ? 'docs/A.md' : C), 'utf8')).toBe(BASE)
    })
  }

  describe('a take never loses what the user changed by hand', () => {
    const user = edited(BASE, 5, 'mine')
    const engine = edited(BASE, 5, 'new')
    // What a refused take must leave alone: the folder's files, the index and the merge itself.
    const state = () => ({
      status: g(work(), 'status', '--short'),
      index: g(work(), 'ls-files', '-s'),
      disk: onDisk(),
    })
    const clash = () => renamedOnBothSides(user, engine)
    const clean = () => renamedOnBothSides(edited(BASE, 2, 'mine'), edited(BASE, 10, 'new'))
    const cases = [
      ['with a content clash', clash, { text: 'ours' }],
      ['without a content clash', clean, {}],
    ] as const

    for (const [how, setUp, opts] of cases) {
      describe(how, () => {
        it('takes an untouched group without refusing', () => {
          setUp()
          const { git } = start()
          expect(takeSide(git, 'ours', B, opts)).toEqual({ kind: 'taken', left: [] })
        })

        for (const [what, change, refuses] of [
          [
            'edited in the first new name',
            () => writeFileSync(join(work(), B), 'EDITED\n'),
            { ours: [B], theirs: [B] },
          ],
          [
            'edited in the second new name',
            () => writeFileSync(join(work(), C), 'EDITED\n'),
            { ours: [C], theirs: [C] },
          ],
          [
            'edited in both new names',
            () => {
              writeFileSync(join(work(), B), 'EDITED\n')
              writeFileSync(join(work(), C), 'EDITED\n')
            },
            { ours: [B, C], theirs: [B, C] },
          ],
          // The take removes the name it does not keep, so only a missing file at the kept name counts.
          [
            'deleted from the first new name',
            () => rmSync(join(work(), B)),
            { ours: [B], theirs: [] },
          ],
          [
            'deleted from the second new name',
            () => rmSync(join(work(), C)),
            { ours: [], theirs: [C] },
          ],
        ] as const) {
          for (const side of ['ours', 'theirs'] as const)
            handEditCases(side, what, { setUp, change, opts }, refuses)
        }

        it('accepts the go-on form when nothing was edited, and changes nothing more', () => {
          setUp()
          const { git } = start()
          expect(takeSide(git, 'theirs', A, { ...opts, discardEdits: true })).toEqual({
            kind: 'taken',
            left: [],
          })
          expect(g(work(), 'ls-files', 'docs').split('\n')).toEqual([C])
        })
      })
    }

    it('names the path the user resolved when only one copy of the markers was edited', () => {
      clash()
      const { git } = start()
      expect(readFileSync(join(work(), B), 'utf8')).toContain('<<<<<<<')
      expect(readFileSync(join(work(), C), 'utf8')).toContain('<<<<<<<')
      writeFileSync(join(work(), C), engine)
      const before = state()
      expect(takeSide(git, 'ours', B, { text: 'ours' })).toEqual({
        kind: 'hand-edited',
        files: [C],
      })
      expect(state()).toEqual(before)
    })

    it('does not compare the old name, so an unsaved file there neither refuses nor goes', () => {
      clean()
      const { git } = start()
      writeFileSync(join(work(), A), 'MY NOTES\n')
      expect(takeSide(git, 'ours', A)).toEqual({ kind: 'taken', left: [] })
      expect(readFileSync(join(work(), A), 'utf8')).toBe('MY NOTES\n')
    })

    it('reports nothing after a settled take: the opposite take finds no clash and changes nothing', () => {
      clash()
      const { git } = start()
      takeSide(git, 'ours', A, { text: 'ours' })
      const before = state()
      expect(takeSide(git, 'theirs', C, { text: 'theirs' })).toEqual({ kind: 'not-clashing' })
      expect(state()).toEqual(before)
    })
  })

  describe('a take that meets something else on disk', () => {
    const clash = () => renamedOnBothSides(edited(BASE, 5, 'mine'), edited(BASE, 5, 'new'))
    const clean = () => renamedOnBothSides()
    const modeOf = (rel: string) => statSync(join(work(), rel)).mode & 0o777
    const snapshot = () => ({
      status: g(work(), 'status', '--short'),
      index: g(work(), 'ls-files', '-s'),
      disk: Object.fromEntries(
        [A, B, C].map((rel) => {
          const stat = lstatSync(join(work(), rel), { throwIfNoEntry: false })
          if (!stat) return [rel, null]
          return [rel, stat.isDirectory() ? 'dir' : readFileSync(join(work(), rel), 'utf8')]
        }),
      ),
      docs: readdirSync(join(work(), 'docs')).sort(),
    })
    // A folder holding a file stands at a new name: the take refuses, whether or not told to go on.
    const refuseFolderWithFile = (
      scene: { setUp: () => void; opts: { text?: 'ours' } },
      name: string,
      discardEdits: boolean,
    ) => {
      scene.setUp()
      const { git } = start()
      rmSync(join(work(), name))
      mkdirSync(join(work(), name))
      writeFileSync(join(work(), name, 'x'), 'MY FILE\n')
      const before = { ...snapshot(), inside: readdirSync(join(work(), name)) }
      expect(takeSide(git, 'ours', A, { ...scene.opts, discardEdits })).toEqual({
        kind: 'in-the-way',
        files: [`${name}/x`],
      })
      expect({ ...snapshot(), inside: readdirSync(join(work(), name)) }).toEqual(before)
      expect(readFileSync(join(work(), name, 'x'), 'utf8')).toBe('MY FILE\n')
    }
    const folderCases = (setUp: () => void, opts: { text?: 'ours' }) => {
      for (const [where, name] of [
        ['the name that is kept', B],
        ['the name that goes', C],
      ] as const) {
        for (const [told, discardEdits] of [
          ['', false],
          [', though told to go on', true],
        ] as const)
          it(`refuses with the files in the way when a folder holding a file stands at ${where}${told}`, () =>
            refuseFolderWithFile({ setUp, opts }, name, discardEdits))
      }
    }
    const emptiedFolderCases = (setUp: () => void, opts: { text?: 'ours' }) => {
      for (const side of ['ours', 'theirs'] as const) {
        for (const [where, name] of [
          ['the first new name', B],
          ['the second new name', C],
        ] as const)
          it(`settles the ${side} take once the user has emptied and removed the folder at ${where}`, () =>
            settleAfterFolder({ setUp, opts }, side, name))
      }
    }

    const cases = [
      ['with a content clash', clash, { text: 'ours' }],
      ['without a content clash', clean, {}],
    ] as const

    for (const [how, setUp, opts] of cases) {
      describe(how, () => {
        folderCases(setUp, opts)
        emptiedFolderCases(setUp, opts)

        it('refuses a take that went on over an executable bit the user set, and changes nothing', () => {
          setUp()
          const { git } = start()
          chmodSync(join(work(), B), 0o755)
          const before = { ...snapshot(), mode: modeOf(B) }
          expect(takeSide(git, 'ours', A, opts)).toEqual({ kind: 'hand-edited', files: [B] })
          expect({ ...snapshot(), mode: modeOf(B) }).toEqual(before)
          expect(takeSide(git, 'ours', A, { ...opts, discardEdits: true })).toEqual({
            kind: 'taken',
            left: [],
          })
          expect(modeOf(B)).toBe(0o644)
        })

        it('does not report a mode edit when git does not track modes', () => {
          setUp()
          const { git } = start()
          g(work(), 'config', 'core.fileMode', 'false')
          chmodSync(join(work(), B), 0o755)
          expect(takeSide(git, 'ours', A, opts)).toEqual({ kind: 'taken', left: [] })
        })
      })
    }
  })

  describe('a binary file renamed to names that differ only in capitals', () => {
    it('is not reported as edited when the two names are one file or two untouched ones', () => {
      const bin = (tail: string) => `\0${BASE}${tail}\n`
      const old = 'docs/Notes.bin'
      cloned({ [old]: bin('base') })
      g(work(), 'mv', old, 'docs/notes.bin')
      userCommit({ 'docs/notes.bin': bin('mine') }, 'Saved: rename')
      g(upstream(), 'mv', old, 'docs/NOTES.bin')
      writeFileSync(join(upstream(), 'docs/NOTES.bin'), bin('new'))
      commitEngine('Rename')
      const { git } = start()
      expect(renamesOf(git)).toMatchObject([{ contentClash: true }])
      expect(takeSide(git, 'theirs', old, { text: 'theirs' })).toEqual({ kind: 'taken', left: [] })
      expect(finishUpdate(work(), git, { run: runner().run })).toEqual({ kind: 'updated' })
      expect(readFileSync(join(work(), 'docs/NOTES.bin'), 'utf8')).toBe(bin('new'))
    })
  })

  describe('a file where a parent folder of a new name should be', () => {
    it.each([['ours'], ['theirs']] as const)(
      "refuses the %s take and keeps the user's file",
      (side) => {
        cloned({ [A]: BASE, 'docs/keep.md': 'kept\n' })
        mkdirSync(join(work(), 'mine'))
        g(work(), 'mv', A, 'mine/b.md')
        userCommit({}, 'Saved: rename into a folder')
        g(upstream(), 'mv', A, 'c.md')
        commitEngine('Rename')
        const { git } = start()
        expect(renamesOf(git)).toMatchObject([{ base: A, ours: 'mine/b.md', theirs: 'c.md' }])
        rmSync(join(work(), 'mine'), { recursive: true })
        writeFileSync(join(work(), 'mine'), 'MY FILE\n')
        const before = g(work(), 'status', '--short')
        for (const discardEdits of [false, true])
          expect(takeSide(git, side, A, { discardEdits })).toEqual({
            kind: 'in-the-way',
            files: ['mine'],
          })
        expect(g(work(), 'status', '--short')).toEqual(before)
        expect(readFileSync(join(work(), 'mine'), 'utf8')).toBe('MY FILE\n')
      },
    )
  })

  describe('the text choice', () => {
    const user = edited(BASE, 5, 'mine')
    const engine = edited(BASE, 5, 'new')
    const state = () => ({ status: g(work(), 'status', '--short'), disk: onDisk() })

    it('is asked for when the content clashes, and nothing changes without it', () => {
      renamedOnBothSides(user, engine)
      const { git } = start()
      const before = state()
      expect(takeSide(git, 'ours', A)).toEqual({
        kind: 'needs-text',
        rename: { base: A, ours: B, theirs: C, contentClash: true },
      })
      expect(state()).toEqual(before)
    })

    it('is refused for a rename whose content does not clash', () => {
      renamedOnBothSides()
      const { git } = start()
      const before = state()
      expect(takeSide(git, 'ours', A, { text: 'ours' })).toEqual({ kind: 'no-text-choice' })
      expect(state()).toEqual(before)
    })

    it('is refused for a file that is no rename', () => {
      cloned({ 'docs/x.md': 'one\n' })
      userCommit({ 'docs/x.md': 'mine\n' }, 'Saved')
      writeFileSync(join(upstream(), 'docs/x.md'), 'new\n')
      commitEngine('Change')
      const { git } = start()
      const before = state()
      expect(takeSide(git, 'ours', 'docs/x.md', { text: 'ours' })).toEqual({
        kind: 'no-text-choice',
      })
      expect(state()).toEqual(before)
    })
  })

  describe('the take command', () => {
    const user = edited(BASE, 5, 'mine')
    const engine = edited(BASE, 5, 'new')
    const take = async (args: string[]) => {
      const lines: unknown[] = []
      const errors: unknown[] = []
      const log = vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
      const error = vi.spyOn(console, 'error').mockImplementation((line) => void errors.push(line))
      const deps = { engineUrl: upstream(), run: runner().run }
      const code = await updateCommand(['take', ...args], work(), deps)
      log.mockRestore()
      error.mockRestore()
      return { code, lines, errors }
    }
    const merged = async () => {
      const deps = { engineUrl: upstream(), run: runner().run }
      await updateCommand(['changes'], work(), deps)
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      await updateCommand(['merge'], work(), deps)
      log.mockRestore()
    }

    it('asks for the text, and names the clash in the same line the merge printed', async () => {
      renamedOnBothSides(user, engine)
      await merged()
      expect(await take(['ours', A])).toEqual({
        code: EXIT.problems,
        lines: [
          `not taken: ${A} was renamed on both sides and its content clashes, so whose text it ends with is a second choice (--text ours or --text theirs); nothing was changed`,
          `- renamed ${A}: yours ${B}, new version ${C}; the content clashes too`,
        ],
        errors: [],
      })
    })

    it('takes with the name of one side and the text of the other', async () => {
      renamedOnBothSides(user, engine)
      await merged()
      expect(await take(['ours', A, '--text', 'theirs'])).toEqual({
        code: 0,
        lines: [`taken: ${A}; no clashes left`],
        errors: [],
      })
      expect(readFileSync(join(work(), B), 'utf8')).toBe(engine)
    })

    it('names the files edited by hand, and goes on when told to', async () => {
      renamedOnBothSides(user, engine)
      await merged()
      writeFileSync(join(work(), B), 'EDITED\n')
      expect(await take(['ours', A, '--text', 'ours'])).toEqual({
        code: EXIT.problems,
        lines: [
          `not taken: you edited these by hand: ${B}; nothing was changed, and --discard-edits goes on anyway`,
        ],
        errors: [],
      })
      expect((await take(['ours', A, '--text', 'ours', '--discard-edits'])).code).toBe(0)
      expect(readFileSync(join(work(), B), 'utf8')).toBe(user)
    })

    it('refuses a text choice for a clean rename as a usage error', async () => {
      renamedOnBothSides()
      await merged()
      const result = await take(['ours', A, '--text', 'ours'])
      expect(result.code).toBe(EXIT.usage)
      expect(result.lines).toEqual([])
      expect(onDisk()[B]).toBe(BASE)
    })

    for (const args of [
      ['ours', A, '--text'],
      ['ours', A, '--text', 'yours'],
      ['ours', A, '--text', 'ours', '--text', 'theirs'],
      ['ours', A, '--discard-edits', '--discard-edits'],
      ['ours', A, '--force'],
      ['ours', A, 'extra'],
    ]) {
      it(`refuses ${args.slice(2).join(' ')} as a usage error`, async () => {
        renamedOnBothSides(user, engine)
        await merged()
        expect((await take(args)).code).toBe(EXIT.usage)
        expect(onDisk()[B]).not.toBe(user)
      })
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
    expect(takeSide(git, 'theirs', B, { text: 'theirs' })).toEqual({ kind: 'taken', left: [] })
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
