import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Git } from '../lib/history.ts'
import { EXIT } from '../lib/problem.ts'
import { renamesOf, takeSide } from '../lib/update-git.ts'
import { updateCommand } from '../update.ts'
import { commitEngine, start } from './update-clash-helpers.ts'
import { cloned, g, runner, upstream, userCommit, work } from './update-helpers.ts'

const BASE = Array.from({ length: 12 }, (_, i) => `line ${i + 1}\n`).join('')
const edited = (text: string, line: number, to: string) => text.replace(`line ${line}\n`, `${to}\n`)
const A = 'docs/a.md'

// The user renames docs/a.md to `ours` and the new version renames it to `theirs`, each in the folder
// its name names; a clash has both sides change the same line.
const scene = (clash: boolean, ours = 'docs/b.md', theirs = 'docs/c.md') => {
  cloned({ [A]: BASE })
  mkdirSync(join(work(), ours, '..'), { recursive: true })
  g(work(), 'mv', A, ours)
  userCommit(clash ? { [ours]: edited(BASE, 5, 'mine') } : {}, 'Saved: rename')
  mkdirSync(join(upstream(), theirs, '..'), { recursive: true })
  g(upstream(), 'mv', A, theirs)
  writeFileSync(join(upstream(), theirs), clash ? edited(BASE, 5, 'new') : BASE)
  commitEngine('Rename')
  return { ours, theirs, ...start() }
}

const tree = (dir: string): Record<string, string | null> =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() && !e.parentPath.includes('.git') && !e.parentPath.includes('node_modules'),
      )
      .map((e) => [
        join(e.parentPath, e.name).slice(dir.length),
        readFileSync(join(e.parentPath, e.name), 'utf8'),
      ]),
  )
const state = (git: Git) => ({
  status: g(work(), 'status', '--short'),
  index: readFileSync(join(work(), '.git/index')).toString('hex'),
  files: tree(work()),
  renames: renamesOf(git),
})

// Runs the real git call and then reports it as failed, as when git changed the index and could not
// finish; `after` runs once the call is through.
const failing =
  (git: Git, step: (args: string[]) => boolean, after: () => void = () => undefined): Git =>
  (args, env) => {
    const done = git(args, env)
    if (!step(args)) return done
    after()
    return { ...done, status: 1, stderr: 'injected failure' }
  }
const steps = {
  'removing the names from the index': (a: string[]) =>
    a[0] === 'update-index' && a.includes('--force-remove'),
  'adding the kept name to the index': (a: string[]) =>
    a[0] === 'update-index' && a.includes('--add'),
  'writing the kept name': (a: string[]) => a[0] === 'checkout-index',
}
const settled = (git: Git, side: 'ours' | 'theirs', text: object, names: string[]) => {
  expect(takeSide(git, side, A, text)).toMatchObject({ kind: 'taken', left: [] })
  const kept = names[side === 'ours' ? 0 : 1] as string
  expect(g(work(), 'ls-files', '--', ...names).split('\n')).toEqual([kept])
  expect(existsSync(join(work(), names[side === 'ours' ? 1 : 0] as string))).toBe(false)
}

afterEach(() => {
  for (const dir of ['x', 'y', 'docs'])
    if (existsSync(join(work(), dir))) chmodSync(join(work(), dir), 0o755)
  rmSync(join(work(), '.git/index.lock'), { force: true })
})

describe('a take whose step fails', () => {
  for (const clash of [false, true])
    for (const side of ['ours', 'theirs'] as const)
      for (const [what, step] of Object.entries(steps))
        it(`puts everything back after a failure ${what}, ${side}, ${clash ? 'with' : 'without'} a content clash`, () => {
          const { git, ours, theirs } = scene(clash)
          const text = clash ? { text: 'ours' as const } : {}
          const before = state(git)
          const result = takeSide(failing(git, step), side, A, text)
          expect(result).toEqual({
            kind: 'failed',
            output: 'injected failure',
            restored: true,
            files: [],
          })
          expect(state(git)).toEqual(before)
          settled(git, side, text, [ours, theirs])
        })

  describe('what a failed take does to the files', () => {
    const modeOf = (rel: string) => lstatSync(join(work(), rel)).mode & 0o777

    it('puts a removed file back with its mode', () => {
      const { git } = scene(false, 'x/b.md', 'y/c.md')
      chmodSync(join(work(), 'x/b.md'), 0o755)
      chmodSync(join(work(), 'y'), 0o555)
      // The executable bit counts as an edit by hand, so the take goes on only when told to.
      const result = takeSide(git, 'theirs', A, { discardEdits: true })
      expect(result).toMatchObject({ kind: 'failed', restored: true, files: [] })
      expect(modeOf('x/b.md')).toBe(0o755)
      expect(modeOf('y/c.md')).toBe(0o644)
    })

    it('leaves the file at the name that goes untouched when the index cannot change', () => {
      const { git } = scene(false)
      const same = (rel: string) => {
        const stat = statSync(join(work(), rel), { bigint: true })
        return { ino: stat.ino, mtime: stat.mtimeNs }
      }
      const before = { b: same('docs/b.md'), c: same('docs/c.md') }
      writeFileSync(join(work(), '.git/index.lock'), '')
      expect(takeSide(git, 'ours', A)).toMatchObject({ kind: 'failed', restored: true, files: [] })
      expect({ b: same('docs/b.md'), c: same('docs/c.md') }).toEqual(before)
    })

    it('names a file that could not be put back', () => {
      const { git } = scene(false, 'x/b.md', 'y/c.md')
      // The removal is through, so the folder the file was in is made read-only before the restore.
      const lockFolder = () => chmodSync(join(work(), 'x'), 0o555)
      const result = takeSide(failing(git, steps['writing the kept name'], lockFolder), 'theirs', A)
      expect(result).toEqual({
        kind: 'failed',
        output: 'injected failure',
        restored: false,
        files: ['x/b.md'],
      })
    })
  })

  describe('a take whose index cannot be put back', () => {
    it('waits out a lock held for a moment and restores', () => {
      const { git } = scene(false)
      const lock = join(work(), '.git/index.lock')
      const before = state(git)
      const result = takeSide(
        failing(git, steps['adding the kept name to the index'], () => {
          writeFileSync(lock, '')
          spawn('sh', ['-c', `sleep 0.2; rm -f '${lock}'`], {
            detached: true,
            stdio: 'ignore',
          }).unref()
        }),
        'ours',
        A,
      )
      expect(result).toEqual({
        kind: 'failed',
        output: 'injected failure',
        restored: true,
        files: [],
      })
      expect(state(git)).toEqual(before)
    })

    for (const side of ['ours', 'theirs'] as const)
      it(`says what to look at when the index cannot be put back, ${side}`, () => {
        const { git } = scene(false)
        const lock = join(work(), '.git/index.lock')
        const result = takeSide(
          failing(git, steps['adding the kept name to the index'], () => writeFileSync(lock, '')),
          side,
          A,
        )
        expect(result).toEqual({
          kind: 'failed',
          output: 'injected failure',
          restored: false,
          files: ['the record of which files this update has settled'],
        })
      })

    it("reports another program holding the index as a failure, with nothing changed and none of the user's files named", () => {
      const { git, ours, theirs } = scene(false)
      const before = state(git)
      writeFileSync(join(work(), '.git/index.lock'), '')
      const result = takeSide(git, 'ours', A)
      expect(result).toMatchObject({ kind: 'failed', restored: true, files: [] })
      expect((result as { output: string }).output).toContain('index.lock')
      expect(state(git)).toEqual(before)
      rmSync(join(work(), '.git/index.lock'))
      settled(git, 'ours', {}, [ours, theirs])
    })

    for (const side of ['ours', 'theirs'] as const)
      for (const clash of [false, true])
        it(`puts back a take that cannot write or remove in the other folder, ${side}, ${clash ? 'with' : 'without'} a content clash`, () => {
          const { git, ours, theirs } = scene(clash, 'x/b.md', 'y/c.md')
          const text = clash ? { text: 'ours' as const } : {}
          const before = state(git)
          chmodSync(join(work(), 'y'), 0o555)
          const result = takeSide(git, side, A, text)
          expect(result).toMatchObject({ kind: 'failed', restored: true, files: [] })
          expect(state(git)).toEqual(before)
          chmodSync(join(work(), 'y'), 0o755)
          settled(git, side, text, [ours, theirs])
        })
  })

  describe('the take command when a step fails', () => {
    const take = async (side: string) => {
      const lines: unknown[] = []
      const errors: unknown[] = []
      const log = vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
      const error = vi.spyOn(console, 'error').mockImplementation((line) => void errors.push(line))
      const code = await updateCommand(['take', side, A], work(), {
        engineUrl: upstream(),
        run: runner().run,
      })
      log.mockRestore()
      error.mockRestore()
      return { code, lines, errors }
    }

    it("exits with the problems code, says nothing was changed and prints the system's words", async () => {
      const { git } = scene(false, 'x/b.md', 'y/c.md')
      const before = state(git)
      chmodSync(join(work(), 'y'), 0o555)
      const result = await take('ours')
      expect(result.code).toBe(EXIT.problems)
      expect(result.lines).toEqual([
        'not taken: the file could not be settled; nothing was changed',
      ])
      expect(result.errors).toHaveLength(1)
      expect(String(result.errors[0])).toContain('y/c.md')
      expect(state(git)).toEqual(before)
    })
  })
})
