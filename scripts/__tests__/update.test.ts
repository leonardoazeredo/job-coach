import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { isEngineFile, updateFromArchive } from '../lib/update.ts'
import type { Run } from '../lib/verified-update.ts'
import { updateCommand } from '../update.ts'
import {
  DATA,
  dir,
  NEW_ENGINE,
  now,
  OLD_ENGINE,
  put,
  read,
  runner,
  source,
  upstream,
  work,
} from './update-helpers.ts'

describe('updateFromArchive', () => {
  beforeEach(() => {
    put(work(), { ...DATA, ...OLD_ENGINE })
    put(upstream(), NEW_ENGINE)
  })

  it('replaces and adds engine files, backs up each replaced one, and leaves data untouched', async () => {
    const { run } = runner()
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result).toEqual({
      kind: 'updated',
      replaced: ['CLAUDE.md', 'config/rules.yaml'],
      added: ['.claude/skills/update-coach/SKILL.md'],
      backup: '.coach/backups/2026-10-29T09-00-00-000Z',
    })
    expect(read('CLAUDE.md')).toBe('new prompt\n')
    expect(read('.claude/skills/update-coach/SKILL.md')).toBe('new skill\n')
    for (const [rel, text] of Object.entries(DATA)) expect(read(rel)).toBe(text)
    if (result.kind !== 'updated') throw new Error(result.kind)
    expect(read(join(result.backup, 'config/rules.yaml'))).toBe('stale_after_days: 14\n')
    expect(read(join(result.backup, 'CLAUDE.md'))).toBe('old prompt\n')
  })

  it('updates when the new version only adds files', async () => {
    rmSync(upstream(), { recursive: true })
    put(upstream(), { ...OLD_ENGINE, 'docs/new.md': 'new\n' })
    const { run } = runner()
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result).toMatchObject({ kind: 'updated', replaced: [], added: ['docs/new.md'] })
    expect(read('docs/new.md')).toBe('new\n')
  })

  it('checks the records before and after, and installs only when the lockfile changed', async () => {
    const plain = runner()
    await updateFromArchive(work(), { now, source: source(), run: plain.run })
    expect(plain.calls).toEqual(['node scripts/check.ts', 'node scripts/check.ts'])

    put(upstream(), { 'package-lock.json': '{"v":2}\n' })
    const locked = runner()
    await updateFromArchive(work(), { now, source: source(), run: locked.run })
    expect(locked.calls).toEqual(['node scripts/check.ts', 'npm ci', 'node scripts/check.ts'])
  })

  it('checks the example before onboarding', async () => {
    rmSync(join(work(), 'profile'), { recursive: true })
    const { run, calls } = runner()
    await updateFromArchive(work(), { now, source: source(), run })
    expect(calls[0]).toBe('node scripts/check.ts --root examples/austin-backend')
  })

  it('undoes the update when the check fails after it', async () => {
    const { run } = runner((call) => call === 2)
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result).toMatchObject({ kind: 'undone' })
    for (const [rel, text] of Object.entries({ ...DATA, ...OLD_ENGINE }))
      expect(read(rel)).toBe(text)
    expect(existsSync(join(work(), '.claude/skills/update-coach/SKILL.md'))).toBe(false)
  })

  it('says so when the files cannot be put back, and names the backup to restore by hand', async () => {
    // The check after the update deletes the backup, so the restore has nothing to copy from.
    const calls: string[] = []
    const run: Run = () => {
      calls.push('check')
      if (calls.length < 2) return { ok: true, output: '' }
      rmSync(join(work(), '.coach/backups'), { recursive: true })
      return { ok: false, output: 'pipeline/acme: status is not a known status' }
    }
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result).toMatchObject({
      kind: 'not-undone',
      backup: '.coach/backups/2026-10-29T09-00-00-000Z',
    })
    if (result.kind !== 'not-undone') throw new Error(result.kind)
    expect(result.output).toContain('pipeline/acme: status is not a known status')
    expect(result.output).toMatch(/ENOENT/)
    expect(read('CLAUDE.md')).toBe('new prompt\n')
  })

  it('undoes the update, without a check, when the install itself fails', async () => {
    put(upstream(), { 'package-lock.json': '{"v":2}\n' })
    const calls: string[] = []
    const run: Run = (cmd, args) => {
      calls.push([cmd, ...args].join(' '))
      return calls.length === 2 ? { ok: false, output: 'npm failed' } : { ok: true, output: '' }
    }
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result).toMatchObject({ kind: 'undone', output: 'npm failed' })
    expect(calls).toEqual(['node scripts/check.ts', 'npm ci', 'npm ci'])
    expect(read('package-lock.json')).toBe('{"v":1}\n')
  })

  it('still reinstalls once, from whatever lock file is in place, when the restore fails', async () => {
    put(upstream(), { 'package-lock.json': '{"v":2}\n' })
    const calls: string[] = []
    const run: Run = (cmd, args) => {
      calls.push([cmd, ...args].join(' '))
      if (calls.length < 3) return { ok: true, output: '' }
      if (calls.length === 3) rmSync(join(work(), '.coach/backups'), { recursive: true })
      return { ok: calls.length !== 3, output: 'check failed' }
    }
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result.kind).toBe('not-undone')
    expect(calls).toEqual(['node scripts/check.ts', 'npm ci', 'node scripts/check.ts', 'npm ci'])
  })

  // The update-coach skill undoes a failed restore by hand from this file, so its name, place and
  // keys are what that step relies on.
  it('writes the backup manifest the skill undoes by hand from', async () => {
    const { run } = runner()
    const result = await updateFromArchive(work(), { now, source: source(), run })
    if (result.kind !== 'updated') throw new Error(result.kind)
    expect(JSON.parse(read(join(result.backup, 'manifest.json')))).toEqual({
      replaced: ['CLAUDE.md', 'config/rules.yaml'],
      added: ['.claude/skills/update-coach/SKILL.md'],
    })
  })

  it('lets the skill put the old version back by hand from the manifest after a failed restore', async () => {
    const files = (base: string) =>
      readdirSync(base, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && !e.parentPath.includes('.coach'))
        .map((e) => join(e.parentPath, e.name).slice(base.length))
        .sort()
    const before = join(dir, 'before')
    cpSync(work(), before, { recursive: true })
    let calls = 0
    // The restore cannot overwrite a read-only file, so it stops after the first replaced file.
    const locked = join(work(), 'config/rules.yaml')
    const run: Run = () => {
      calls++
      if (calls < 2) return { ok: true, output: '' }
      chmodSync(locked, 0o444)
      return { ok: false, output: 'check failed' }
    }
    const result = await updateFromArchive(work(), { now, source: source(), run })
    if (result.kind !== 'not-undone') throw new Error(result.kind)
    expect(existsSync(join(work(), '.claude/skills/update-coach/SKILL.md'))).toBe(true)

    // The skill's steps: copy each replaced file back from the backup, delete each added one.
    chmodSync(locked, 0o644)
    const manifest = JSON.parse(read(join(result.backup, 'manifest.json')))
    for (const rel of manifest.replaced) cpSync(join(work(), result.backup, rel), join(work(), rel))
    for (const rel of manifest.added) rmSync(join(work(), rel), { force: true })

    expect(files(work())).toEqual(files(before))
    for (const rel of files(before)) expect(read(rel)).toBe(readFileSync(join(before, rel), 'utf8'))
  })

  it('reinstalls the old dependencies when it undoes a lockfile change', async () => {
    put(upstream(), { 'package-lock.json': '{"v":2}\n' })
    const { run, calls } = runner((call) => call === 3)
    await updateFromArchive(work(), { now, source: source(), run })
    expect(calls.at(-1)).toBe('npm ci')
    expect(read('package-lock.json')).toBe('{"v":1}\n')
  })

  it('does not start when the records already fail the check', async () => {
    const { run } = runner((call) => call === 1)
    const result = await updateFromArchive(work(), { now, source: source(), run })
    expect(result).toEqual({
      kind: 'not-started',
      output: 'pipeline/acme: status is not a known status',
    })
    expect(read('CLAUDE.md')).toBe('old prompt\n')
  })

  it('reports the latest version when no engine file differs', async () => {
    rmSync(upstream(), { recursive: true })
    put(upstream(), OLD_ENGINE)
    const { run } = runner()
    expect(await updateFromArchive(work(), { now, source: source(), run })).toEqual({
      kind: 'latest',
    })
    expect(existsSync(join(work(), '.coach/backups'))).toBe(false)
  })
})

describe('isEngineFile', () => {
  it('keeps the data folders and local state out, except the engine READMEs and templates', () => {
    expect(isEngineFile('scripts/check.ts')).toBe(true)
    expect(isEngineFile('.claude/skills/onboarding/prerequisites.md')).toBe(true)
    expect(isEngineFile('pipeline/README.md')).toBe(true)
    expect(isEngineFile('pipeline/_templates/record.yaml')).toBe(true)
    expect(isEngineFile('experience-bank/README.md')).toBe(true)
    expect(isEngineFile('pipeline/acme/record.yaml')).toBe(false)
    expect(isEngineFile('experience-bank/acme.md')).toBe(false)
    expect(isEngineFile('profile/identity.yaml')).toBe(false)
    expect(isEngineFile('cv/master.json')).toBe(false)
    expect(isEngineFile('.coach/state.json')).toBe(false)
  })
})

describe('updateCommand', () => {
  it('refuses a ZIP update in a folder that keeps history', async () => {
    mkdirSync(work())
    execFileSync('git', ['init', '-q', work()])
    expect(await updateCommand(['zip'], work(), { source: source() })).toBe(EXIT.usage)
  })

  it('reports a failed download without touching the folder', async () => {
    put(work(), OLD_ENGINE)
    const offline = source({
      download: async () => {
        throw new Error('fetch failed')
      },
    })
    const run: Run = () => ({ ok: true, output: '' })
    expect(await updateFromArchive(work(), { now, source: offline, run })).toEqual({
      kind: 'not-fetched',
      output: 'fetch failed',
    })
    expect(await updateCommand(['zip'], work(), { source: offline, run })).toBe(EXIT.problems)
    expect(read('CLAUDE.md')).toBe('old prompt\n')
  })

  it('names the settings files it replaced, so a changed one can be brought back', async () => {
    put(work(), { ...DATA, ...OLD_ENGINE })
    put(upstream(), NEW_ENGINE)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const run: Run = () => ({ ok: true, output: '' })
    expect(await updateCommand(['zip'], work(), { now, source: source(), run })).toBe(0)
    expect(log.mock.calls[0]?.[0]).toBe(
      'updated: 2 replaced, 1 added; backup in .coach/backups/2026-10-29T09-00-00-000Z; settings replaced: config/rules.yaml',
    )
    log.mockRestore()
  })

  it('prints not undone with the backup folder and exits 1 when the files cannot be put back', async () => {
    put(work(), { ...DATA, ...OLD_ENGINE })
    put(upstream(), NEW_ENGINE)
    let calls = 0
    const run: Run = () => {
      calls++
      if (calls < 2) return { ok: true, output: '' }
      rmSync(join(work(), '.coach/backups'), { recursive: true })
      return { ok: false, output: 'check failed' }
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await updateCommand(['zip'], work(), { now, source: source(), run })).toBe(EXIT.problems)
    expect(log.mock.calls[0]?.[0]).toBe(
      'not undone: the install or the record check failed after the update, and the files could not be put back; the old ones are in .coach/backups/2026-10-29T09-00-00-000Z',
    )
    expect(String(error.mock.calls[0]?.[0])).toMatch(/^check failed\n/)
    log.mockRestore()
    error.mockRestore()
  })

  it('refuses an unknown subcommand', async () => {
    expect(await updateCommand(['now'], dir)).toBe(EXIT.usage)
    expect(await updateCommand(['check', '--soon'], dir)).toBe(EXIT.usage)
  })
})
