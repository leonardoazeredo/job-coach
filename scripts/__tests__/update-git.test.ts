import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ENGINE_URL, gitIn } from '../lib/history.ts'
import { EXIT } from '../lib/problem.ts'
import {
  cancelUpdate,
  engineChanges,
  finishUpdate,
  mergeEngine,
  takeSide,
} from '../lib/update-git.ts'
import { updateCommand } from '../update.ts'
import { DATA, dir, OLD_ENGINE, put, read, runner, upstream, work } from './update-helpers.ts'

const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const identify = (cwd: string) => {
  g(cwd, 'config', 'user.email', 'test@example.com')
  g(cwd, 'config', 'user.name', 'Test')
}
const commitAll = (cwd: string, message: string, env: NodeJS.ProcessEnv = {}) => {
  g(cwd, 'add', '-A')
  execFileSync('git', ['commit', '-q', '-m', message], { cwd, env: { ...process.env, ...env } })
}
const engineCommit = (files: Record<string, string>, message: string) => {
  put(upstream(), files)
  commitAll(upstream(), message)
}
const userCommit = (files: Record<string, string>, message: string) => {
  put(work(), files)
  commitAll(work(), message)
}
const head = () => g(work(), 'rev-parse', 'HEAD')
const merging = () => existsSync(join(work(), '.git/MERGE_HEAD'))

const startEngine = () => {
  put(upstream(), OLD_ENGINE)
  g(upstream(), 'init', '-q', '-b', 'main')
  identify(upstream())
  // Dated well before any copy, so the copy's own first commit cannot share its second.
  const past = '2026-01-01T00:00:00Z'
  commitAll(upstream(), 'Engine', { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past })
}
// A folder that already shares history with the engine, as after its first update.
const cloned = (engineFiles: Record<string, string> = {}) => {
  startEngine()
  if (Object.keys(engineFiles).length) engineCommit(engineFiles, 'More engine')
  g(dir, 'clone', '-q', upstream(), work())
  identify(work())
  userCommit(DATA, 'Saved: profile')
}
// A copy made with "Use this template": the engine's files, but a history of its own.
const templated = () => {
  startEngine()
  put(work(), { ...OLD_ENGINE, ...DATA })
  g(work(), 'init', '-q', '-b', 'main')
  identify(work())
  commitAll(work(), 'Initial commit')
}

const opts = () => ({ url: upstream() })
const gitOf = () => {
  const git = gitIn(work())
  if (!git) throw new Error('no git')
  return git
}

describe('engineChanges', () => {
  it('says latest when the engine has nothing this folder lacks', () => {
    cloned()
    expect(engineChanges(gitOf(), opts())).toEqual({ kind: 'latest' })
  })

  it('lists what the engine changed since this folder last updated', () => {
    cloned()
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    expect(engineChanges(gitOf(), opts())).toEqual({
      kind: 'available',
      changes: ['Sharper prompt'],
    })
  })

  it('connects a template copy to the engine before its first update', () => {
    templated()
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    const result = engineChanges(gitOf(), opts())
    expect(result.kind).toBe('available')
    expect(g(work(), 'remote', 'get-url', 'upstream')).toBe(upstream())
  })

  // A rewrite stands in for GitHub here, and also covers a user whose git rewrites GitHub
  // addresses: the remote is known by the address it was given, not by where git sends it.
  it('knows the engine by the address it was given, however git rewrites it', () => {
    templated()
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    g(work(), 'config', `url.${upstream()}.insteadOf`, ENGINE_URL)
    g(work(), 'remote', 'add', 'upstream', ENGINE_URL)
    expect(engineChanges(gitOf()).kind).toBe('available')
    expect(g(work(), 'remote')).toBe('upstream')
  })

  it('says latest for a template copy the engine has not changed since', () => {
    templated()
    expect(engineChanges(gitOf(), opts())).toEqual({ kind: 'latest' })
  })

  it('reports a fetch that fails and changes nothing', () => {
    cloned()
    const before = head()
    expect(engineChanges(gitOf(), { url: join(dir, 'missing') })).toMatchObject({
      kind: 'not-fetched',
    })
    expect(head()).toBe(before)
  })
})

describe('mergeEngine and finishUpdate', () => {
  it('merges, commits, checks and keeps the user data as it was', () => {
    cloned()
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    const git = gitOf()
    const before = head()
    engineChanges(git, opts())
    expect(mergeEngine(git, opts())).toEqual({ kind: 'merged' })
    const { run, calls } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(read('CLAUDE.md')).toBe('new prompt\n')
    for (const [rel, text] of Object.entries(DATA)) expect(read(rel)).toBe(text)
    expect(g(work(), 'rev-parse', 'HEAD^1')).toBe(before)
    expect(g(work(), 'log', '-1', '--format=%s')).toBe('Updated the coach')
    expect(calls).toEqual(['node scripts/check.ts'])
  })

  it('stops on a file both sides changed, and finishes once the user chose a side', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    const git = gitOf()
    engineChanges(git, opts())
    expect(mergeEngine(git, opts())).toEqual({
      kind: 'clashes',
      files: ['config/rules.yaml'],
    })
    const { run } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({
      kind: 'clashes',
      files: ['config/rules.yaml'],
    })
    expect(takeSide(git, 'ours', 'config/rules.yaml')).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(read('config/rules.yaml')).toBe('stale_after_days: 30\n')
  })

  // Without the file as it was before either side changed it, a clash cannot say which
  // values the user changed, and the coach credits them with the engine's old default.
  it('shows each clash with the version both sides started from', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    const git = gitOf()
    engineChanges(git, opts())
    mergeEngine(git, opts())
    expect(read('config/rules.yaml')).toBe(
      '<<<<<<< yours\nstale_after_days: 30\n||||||| before\nstale_after_days: 14\n=======\nstale_after_days: 21\n>>>>>>> new version\n',
    )
  })

  it('shows the clash of a first update with the version the copy was made from', () => {
    templated()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    const git = gitOf()
    engineChanges(git, opts())
    mergeEngine(git, opts())
    expect(read('config/rules.yaml')).toContain('||||||| before\nstale_after_days: 14\n')
  })

  // In the third live update run, taking the user's whole file took back the new follow-up value
  // the coach had just told her she would get.
  const besideTheirs = () => {
    cloned({ 'config/two.yaml': 'stale: 14\nfollow: 5\n' })
    userCommit({ 'config/two.yaml': 'stale: 10\nfollow: 5\n' }, 'Saved: settings')
    engineCommit({ 'config/two.yaml': 'stale: 21\nfollow: 3\n' }, 'New defaults')
    const git = gitOf()
    engineChanges(git, opts())
    mergeEngine(git, opts())
    return git
  }

  it('narrows a clash to the lines both sides changed', () => {
    besideTheirs()
    expect(read('config/two.yaml')).toBe(
      '<<<<<<< yours\nstale: 10\n||||||| before\nstale: 14\n=======\nstale: 21\n>>>>>>> new version\nfollow: 3\n',
    )
  })

  it('keeps the new value beside a clash when the user keeps theirs', () => {
    const git = besideTheirs()
    expect(takeSide(git, 'ours', 'config/two.yaml')).toEqual({ kind: 'taken', left: [] })
    expect(read('config/two.yaml')).toBe('stale: 10\nfollow: 3\n')
  })

  it('takes only the clashing lines from the new version', () => {
    const git = besideTheirs()
    takeSide(git, 'theirs', 'config/two.yaml')
    expect(read('config/two.yaml')).toBe('stale: 21\nfollow: 3\n')
  })

  it('accepts a file the coach wrote by hand once no clash marker is left in it', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\nnew_key: 1\n' }, 'New key')
    const git = gitOf()
    engineChanges(git, opts())
    mergeEngine(git, opts())
    writeFileSync(join(work(), 'config/rules.yaml'), 'stale_after_days: 30\nnew_key: 1\n')
    const { run } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(read('config/rules.yaml')).toBe('stale_after_days: 30\nnew_key: 1\n')
  })

  it('waits for a choice on a file the user changed and the engine removed', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    g(upstream(), 'rm', '-q', 'config/rules.yaml')
    commitAll(upstream(), 'Drop rules')
    const git = gitOf()
    engineChanges(git, opts())
    expect(mergeEngine(git, opts())).toEqual({ kind: 'clashes', files: ['config/rules.yaml'] })
    const { run } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({
      kind: 'clashes',
      files: ['config/rules.yaml'],
    })
    expect(takeSide(git, 'theirs', 'config/rules.yaml')).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(existsSync(join(work(), 'config/rules.yaml'))).toBe(false)
  })

  it('refuses to take a side of a file that does not clash', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    const git = gitOf()
    expect(takeSide(git, 'theirs', 'config/rules.yaml')).toEqual({ kind: 'no-merge' })
    engineChanges(git, opts())
    mergeEngine(git, opts())
    expect(takeSide(git, 'theirs', 'CLAUDE.md')).toEqual({ kind: 'not-clashing' })
  })

  it('undoes the whole update when the record check fails afterwards', () => {
    cloned()
    engineCommit({ 'CLAUDE.md': 'new prompt\n', 'package-lock.json': '{"v":2}\n' }, 'New tools')
    const git = gitOf()
    const before = head()
    engineChanges(git, opts())
    mergeEngine(git, opts())
    const { run, calls } = runner((call) => call === 2)
    expect(finishUpdate(work(), git, { run })).toMatchObject({ kind: 'undone' })
    expect(head()).toBe(before)
    expect(read('CLAUDE.md')).toBe('old prompt\n')
    expect(merging()).toBe(false)
    expect(calls).toEqual(['npm ci', 'node scripts/check.ts', 'npm ci'])
  })

  it('takes the new version of each untouched engine file on a first update', () => {
    templated()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit(
      { 'CLAUDE.md': 'new prompt\n', 'config/rules.yaml': 'stale_after_days: 21\n' },
      'New prompt and default',
    )
    const git = gitOf()
    engineChanges(git, opts())
    expect(mergeEngine(git, opts())).toEqual({
      kind: 'clashes',
      files: ['config/rules.yaml'],
    })
    expect(read('CLAUDE.md')).toBe('new prompt\n')
    expect(takeSide(git, 'theirs', 'config/rules.yaml')).toEqual({ kind: 'taken', left: [] })
    const { run } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(read('config/rules.yaml')).toBe('stale_after_days: 21\n')
    expect(g(work(), 'merge-base', '--is-ancestor', 'upstream/main', 'HEAD')).toBe('')
  })

  it('keeps a file only the user changed on a first update, without asking', () => {
    templated()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    const git = gitOf()
    engineChanges(git, opts())
    expect(mergeEngine(git, opts())).toEqual({ kind: 'merged' })
    expect(read('config/rules.yaml')).toBe('stale_after_days: 30\n')
    expect(read('CLAUDE.md')).toBe('new prompt\n')
  })

  it('asks for the changes first when nothing has been fetched', () => {
    templated()
    expect(mergeEngine(gitOf(), opts())).toEqual({ kind: 'not-fetched' })
  })
})

describe('cancelUpdate', () => {
  it('abandons a merge in progress and leaves the folder as it was', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    const git = gitOf()
    const before = head()
    engineChanges(git, opts())
    mergeEngine(git, opts())
    expect(cancelUpdate(git)).toEqual({ kind: 'cancelled' })
    expect(head()).toBe(before)
    expect(merging()).toBe(false)
    expect(read('config/rules.yaml')).toBe('stale_after_days: 30\n')
  })
})

describe('updateCommand with history', () => {
  const printed = async (args: string[], root = work()) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = await updateCommand(args, root, { engineUrl: upstream(), run: runner().run })
    const lines = log.mock.calls.map((c) => c[0])
    log.mockRestore()
    error.mockRestore()
    return { code, lines }
  }

  it('prints the changes, the clashes and the result, one plain line each', async () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    expect(await printed(['changes'])).toEqual({ code: 0, lines: ['available', '- New default'] })
    expect(await printed(['merge'])).toEqual({ code: 0, lines: ['clashes: config/rules.yaml'] })
    expect(await printed(['finish'])).toEqual({
      code: EXIT.problems,
      lines: ['clashes left: config/rules.yaml'],
    })
    expect(await printed(['take', 'theirs', 'config/rules.yaml'])).toEqual({
      code: 0,
      lines: ['taken: config/rules.yaml; no clashes left'],
    })
    expect(await printed(['finish'])).toEqual({ code: 0, lines: ['updated'] })
  })

  it('refuses the history steps in a folder that keeps no history', async () => {
    mkdirSync(work())
    for (const args of [['changes'], ['merge'], ['finish'], ['cancel']]) {
      expect((await printed(args)).code).toBe(EXIT.usage)
    }
  })

  it('refuses a take with no side or no file', async () => {
    cloned()
    expect((await printed(['take', 'mine', 'CLAUDE.md'])).code).toBe(EXIT.usage)
    expect((await printed(['take', 'ours'])).code).toBe(EXIT.usage)
    expect((await printed(['constructor'])).code).toBe(EXIT.usage)
  })
})
