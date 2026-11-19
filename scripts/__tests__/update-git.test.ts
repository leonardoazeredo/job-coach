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
import {
  cloned,
  commitAll,
  DATA,
  dir,
  engineCommit,
  g,
  head,
  merging,
  read,
  runner,
  templated,
  upstream,
  userCommit,
  work,
} from './update-helpers.ts'

const opts = () => ({ url: upstream() })
// A merge checks the records first; the stub passes, so no test runs the real check.
const mergeOpts = () => ({ ...opts(), run: runner().run })
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
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({ kind: 'merged' })
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
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({
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
    mergeEngine(work(), git, mergeOpts())
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
    mergeEngine(work(), git, mergeOpts())
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
    return { git, merged: mergeEngine(work(), git, mergeOpts()) }
  }

  it('narrows a clash to the lines both sides changed, and lists the lines it settled', () => {
    const { merged } = besideTheirs()
    expect(merged).toEqual({
      kind: 'clashes',
      files: ['config/two.yaml'],
      settled: [{ file: 'config/two.yaml', from: 'new version', line: 'follow: 3' }],
    })
    expect(read('config/two.yaml')).toBe(
      '<<<<<<< yours\nstale: 10\n||||||| before\nstale: 14\n=======\nstale: 21\n>>>>>>> new version\nfollow: 3\n',
    )
  })

  it('keeps the new value beside a clash when the user keeps theirs', () => {
    const { git } = besideTheirs()
    expect(takeSide(git, 'ours', 'config/two.yaml')).toEqual({ kind: 'taken', left: [] })
    expect(read('config/two.yaml')).toBe('stale: 10\nfollow: 3\n')
  })

  it('takes only the clashing lines from the new version', () => {
    const { git } = besideTheirs()
    takeSide(git, 'theirs', 'config/two.yaml')
    expect(read('config/two.yaml')).toBe('stale: 21\nfollow: 3\n')
  })

  it('accepts a file the coach wrote by hand once no clash marker is left in it', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\nnew_key: 1\n' }, 'New key')
    const git = gitOf()
    engineChanges(git, opts())
    mergeEngine(work(), git, mergeOpts())
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
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({
      kind: 'clashes',
      files: ['config/rules.yaml'],
    })
    const { run } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({
      kind: 'clashes',
      files: ['config/rules.yaml'],
    })
    expect(takeSide(git, 'theirs', 'config/rules.yaml')).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(existsSync(join(work(), 'config/rules.yaml'))).toBe(false)
  })

  it('removes a guide the engine removed, though its heading underline looks like a marker', () => {
    cloned({ 'docs/guide.md': 'Guide\n=======\n\nStep one.\n' })
    userCommit({ 'docs/guide.md': 'Guide\n=======\n\nMy step one.\n' }, 'Saved: guide')
    g(upstream(), 'rm', '-q', 'docs/guide.md')
    commitAll(upstream(), 'Drop guide')
    const git = gitOf()
    engineChanges(git, opts())
    mergeEngine(work(), git, mergeOpts())
    expect(takeSide(git, 'theirs', 'docs/guide.md')).toEqual({ kind: 'taken', left: [] })
    expect(existsSync(join(work(), 'docs/guide.md'))).toBe(false)
  })

  it('waits for a choice on a binary file both sides changed', () => {
    cloned({ 'assets/logo.bin': 'a\0base\n' })
    userCommit({ 'assets/logo.bin': 'a\0mine\n' }, 'Saved: logo')
    engineCommit({ 'assets/logo.bin': 'a\0new\n' }, 'New logo')
    const git = gitOf()
    engineChanges(git, opts())
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({
      kind: 'clashes',
      files: ['assets/logo.bin'],
    })
    const { run } = runner()
    expect(finishUpdate(work(), git, { run })).toEqual({
      kind: 'clashes',
      files: ['assets/logo.bin'],
    })
    expect(takeSide(git, 'theirs', 'assets/logo.bin')).toEqual({ kind: 'taken', left: [] })
    expect(finishUpdate(work(), git, { run })).toEqual({ kind: 'updated' })
    expect(read('assets/logo.bin')).toBe('a\0new\n')
  })

  it('leaves a clash in a guide whole, settling no line of it alone', () => {
    cloned({ 'docs/guide.md': 'Step: one\nThen: two\n' })
    userCommit({ 'docs/guide.md': 'Step: mine\nThen: two\n' }, 'Saved: guide')
    engineCommit({ 'docs/guide.md': 'Step: one\nThen: new\n' }, 'Clearer guide')
    const git = gitOf()
    engineChanges(git, opts())
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({
      kind: 'clashes',
      files: ['docs/guide.md'],
    })
    expect(read('docs/guide.md')).toContain('Step: mine\nThen: two\n||||||| before')
  })

  it('does not start when the records already fail the check, and changes nothing', () => {
    cloned()
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    const git = gitOf()
    const before = head()
    engineChanges(git, opts())
    const { run, calls } = runner((call) => call === 1)
    expect(mergeEngine(work(), git, { ...opts(), run })).toEqual({
      kind: 'not-started',
      output: 'pipeline/acme: status is not a known status',
    })
    expect(calls).toEqual(['node scripts/check.ts'])
    expect(merging()).toBe(false)
    expect(head()).toBe(before)
    expect(read('CLAUDE.md')).toBe('old prompt\n')
  })

  it('prints not started and exits 1 when the records already fail the check', async () => {
    cloned()
    engineCommit({ 'CLAUDE.md': 'new prompt\n' }, 'Sharper prompt')
    engineChanges(gitOf(), opts())
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = runner((call) => call === 1).run
    expect(await updateCommand(['merge'], work(), { engineUrl: upstream(), run })).toBe(
      EXIT.problems,
    )
    expect(log.mock.calls[0]?.[0]).toBe('not started: the record check fails before the update')
    expect(error.mock.calls[0]?.[0]).toBe('pipeline/acme: status is not a known status')
    expect(merging()).toBe(false)
    log.mockRestore()
    error.mockRestore()
  })

  it('refuses to take a side of a file that does not clash', () => {
    cloned()
    userCommit({ 'config/rules.yaml': 'stale_after_days: 30\n' }, 'Saved: settings')
    engineCommit({ 'config/rules.yaml': 'stale_after_days: 21\n' }, 'New default')
    const git = gitOf()
    expect(takeSide(git, 'theirs', 'config/rules.yaml')).toEqual({ kind: 'no-merge' })
    engineChanges(git, opts())
    mergeEngine(work(), git, mergeOpts())
    expect(takeSide(git, 'theirs', 'CLAUDE.md')).toEqual({ kind: 'not-clashing' })
  })

  it('undoes the whole update when the record check fails afterwards', () => {
    cloned()
    engineCommit({ 'CLAUDE.md': 'new prompt\n', 'package-lock.json': '{"v":2}\n' }, 'New tools')
    const git = gitOf()
    const before = head()
    engineChanges(git, opts())
    mergeEngine(work(), git, mergeOpts())
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
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({
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
    expect(mergeEngine(work(), git, mergeOpts())).toEqual({ kind: 'merged' })
    expect(read('config/rules.yaml')).toBe('stale_after_days: 30\n')
    expect(read('CLAUDE.md')).toBe('new prompt\n')
  })

  it('asks for the changes first when nothing has been fetched', () => {
    templated()
    expect(mergeEngine(work(), gitOf(), mergeOpts())).toEqual({ kind: 'not-fetched' })
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
    mergeEngine(work(), git, mergeOpts())
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

  it('prints each line it settled inside a clash', async () => {
    cloned({ 'config/two.yaml': 'stale: 14\nfollow: 5\n' })
    userCommit({ 'config/two.yaml': 'stale: 10\nfollow: 5\n' }, 'Saved: settings')
    engineCommit({ 'config/two.yaml': 'stale: 21\nfollow: 3\n' }, 'New defaults')
    await printed(['changes'])
    expect(await printed(['merge'])).toEqual({
      code: 0,
      lines: [
        'clashes: config/two.yaml',
        '- settled config/two.yaml, from the new version: follow: 3',
      ],
    })
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
