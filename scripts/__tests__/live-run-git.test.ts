import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { applyTree, withoutGitVariables } from '../../examples/live-run/replay.ts'
import { repoRoot } from '../lib/workspace.ts'
import { gitAt, gitIn } from './live-run-git.ts'

const tmp = mkdtempSync(join(tmpdir(), 'replay-git-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const saved = { ...process.env }
// Only a decoy repository in the temp folder is ever pointed at; the real one never is.
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k]
  Object.assign(process.env, saved)
})

const repo = (name: string) => {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  gitIn(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'CLAUDE.md'), 'old\n')
  gitIn(dir, 'add', '-A')
  gitIn(dir, 'commit', '-q', '-m', 'base')
  return dir
}
const head = (dir: string) => gitIn(dir, 'rev-parse', 'HEAD').stdout.trim()
const index = (dir: string) => readFileSync(join(dir, '.git', 'index')).toString('hex')

describe('dropping the variables a hook sets', () => {
  it('keeps only what is not a GIT_ variable', () => {
    expect(
      withoutGitVariables({ GIT_DIR: 'x', GIT_WORK_TREE: 'y', GIT_INDEX_FILE: 'z', A: 'b' }),
    ).toEqual({
      A: 'b',
    })
  })

  it('leaves a repository alone that GIT_DIR points at while others are worked on', () => {
    const decoy = repo('decoy')
    const target = repo('target')
    const [decoyHead, decoyIndex] = [head(decoy), index(decoy)]
    process.env.GIT_DIR = join(decoy, '.git')
    process.env.GIT_WORK_TREE = decoy
    process.env.GIT_INDEX_FILE = join(decoy, '.git', 'index')
    writeFileSync(join(target, 'f.txt'), 'x\n')
    gitIn(target, 'add', '-A')
    gitAt('2026-10-04T09:00:00Z')(target, 'commit', '-q', '-m', 'in target')
    const root = join(tmp, 'tree')
    mkdirSync(join(root, '.claude', 'skills', 'new'), { recursive: true })
    writeFileSync(join(root, 'CLAUDE.md'), 'new\n')
    writeFileSync(join(root, '.claude', 'skills', 'new', 'SKILL.md'), 's\n')
    applyTree(target, root)
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[k]
    expect(gitIn(target, 'rev-list', '--count', 'HEAD').stdout.trim()).toBe('3')
    expect(head(decoy)).toBe(decoyHead)
    expect(index(decoy)).toBe(decoyIndex)
  })
})

describe('the guard', () => {
  it('refuses a repository outside the temp folder, before running anything', () => {
    expect(() => gitIn(repoRoot(), 'status')).toThrow(/not a repository in the temp folder/)
  })

  it('names the problem for a folder that is no repository', () => {
    const plain = join(tmp, 'plain')
    mkdirSync(plain)
    expect(() => gitIn(plain, 'status')).toThrow(/not a repository in the temp folder/)
  })
})
