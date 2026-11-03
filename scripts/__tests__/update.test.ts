import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { isEngineFile, type Run, updateFromArchive } from '../lib/update.ts'
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

  it('refuses an unknown subcommand', async () => {
    expect(await updateCommand(['now'], dir)).toBe(EXIT.usage)
    expect(await updateCommand(['check', '--soon'], dir)).toBe(EXIT.usage)
  })
})
