import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { applyTree } from '../../examples/live-run/replay.ts'

const tmp = mkdtempSync(join(tmpdir(), 'replay-tree-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const BASE_DATE = '2026-10-04T09:00:00Z'
const git = (cwd: string, ...a: string[]) =>
  spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: BASE_DATE, GIT_COMMITTER_DATE: BASE_DATE },
  })

const makeTree = (name: string, claude: string) => {
  const root = join(tmp, name)
  mkdirSync(join(root, '.claude', 'skills', 'new'), { recursive: true })
  writeFileSync(join(root, 'CLAUDE.md'), claude)
  writeFileSync(join(root, '.claude', 'skills', 'new', 'SKILL.md'), 's\n')
  return root
}

const makeCopy = (name: string) => {
  const copy = join(tmp, name)
  mkdirSync(join(copy, '.claude', 'skills', 'old'), { recursive: true })
  git(copy, 'init', '-q', '-b', 'main')
  writeFileSync(join(copy, 'a.txt'), 'one\n')
  writeFileSync(join(copy, 'CLAUDE.md'), 'old\n')
  writeFileSync(join(copy, '.claude', 'skills', 'old', 'SKILL.md'), 'o\n')
  git(copy, 'add', '-A')
  git(copy, 'commit', '-q', '-m', 'base')
  return copy
}

const count = (copy: string) => git(copy, 'rev-list', '--count', 'HEAD').stdout.trim()

describe('applying the wording under test', () => {
  it('commits it with the base commit\u2019s date', () => {
    const copy = makeCopy('dated')
    applyTree(copy, makeTree('t-dated', 'new\n'))
    expect(count(copy)).toBe('2')
    expect(git(copy, 'log', '-1', '--format=%cI').stdout.trim()).toBe('2026-10-04T09:00:00Z')
    expect(git(copy, 'log', '-1', '--format=%aI').stdout.trim()).toBe('2026-10-04T09:00:00Z')
    expect(git(copy, 'status', '--short').stdout).toBe('')
  })

  it('makes no commit when the tree is already what the copy holds', () => {
    const copy = makeCopy('same')
    const root = makeTree('t-same', 'old\n')
    rmSync(join(copy, '.claude', 'skills'), { recursive: true })
    mkdirSync(join(copy, '.claude', 'skills'), { recursive: true })
    spawnSync('cp', ['-R', join(root, '.claude', 'skills', 'new'), join(copy, '.claude', 'skills')])
    git(copy, 'add', '-A')
    git(copy, 'commit', '-q', '-m', 'same wording')
    const before = count(copy)
    applyTree(copy, root)
    expect(count(copy)).toBe(before)
  })

  it('writes the files and leaves a merge, its index and the history alone', () => {
    const copy = makeCopy('merging')
    git(copy, 'checkout', '-q', '-b', 'other')
    writeFileSync(join(copy, 'a.txt'), 'two\n')
    git(copy, 'commit', '-q', '-am', 'other change')
    git(copy, 'checkout', '-q', 'main')
    writeFileSync(join(copy, 'b.txt'), 'side\n')
    git(copy, 'add', '-A')
    git(copy, 'commit', '-q', '-m', 'main change')
    git(copy, 'merge', '--no-commit', '--no-ff', 'other')
    const state = () => ({
      merge: git(copy, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').status,
      head: git(copy, 'rev-parse', 'HEAD').stdout,
      index: git(copy, 'diff', '--cached', '--name-status').stdout,
    })
    const before = state()
    expect(before.merge).toBe(0)
    applyTree(copy, makeTree('t-merge', 'new\n'))
    expect(readFileSync(join(copy, 'CLAUDE.md'), 'utf8')).toBe('new\n')
    expect(existsSync(join(copy, '.claude', 'skills', 'new', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(copy, '.claude', 'skills', 'old'))).toBe(false)
    expect(state()).toEqual(before)
  })
})
