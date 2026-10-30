import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import {
  checkForUpdate,
  type EngineSource,
  isEngineFile,
  type Run,
  updateFromArchive,
} from '../lib/update.ts'
import { updateCommand } from '../update.ts'

let dir: string
let savedEnv: NodeJS.ProcessEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  // A git hook exports GIT_DIR and friends, which would point every git call here at the
  // repo being pushed instead of the temp one; the machine's own config could add hooks.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  dir = mkdtempSync(join(tmpdir(), 'update-'))
})
afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

const put = (base: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(base, rel)), { recursive: true })
    writeFileSync(join(base, rel), text)
  }
}
const work = () => join(dir, 'work')
const upstream = () => join(dir, 'upstream')
const read = (rel: string) => readFileSync(join(work(), rel), 'utf8')

const DATA = {
  'profile/identity.yaml': 'name: Mira\n',
  'cv/master.json': '{"name":"Mira"}\n',
  'pipeline/acme/record.yaml': 'status: Applied\n',
  'experience-bank/acme.md': 'notes\n',
}
const OLD_ENGINE = {
  'CLAUDE.md': 'old prompt\n',
  'config/rules.yaml': 'stale_after_days: 14\n',
  'pipeline/README.md': 'old pipeline readme\n',
  'package-lock.json': '{"v":1}\n',
}

// Upstream also ships its own copies of data paths, to prove they are never copied.
const NEW_ENGINE = {
  'CLAUDE.md': 'new prompt\n',
  'config/rules.yaml': 'stale_after_days: 21\n',
  'pipeline/README.md': 'old pipeline readme\n',
  'package-lock.json': '{"v":1}\n',
  '.claude/skills/update-coach/SKILL.md': 'new skill\n',
  'profile/identity.yaml': 'name: Someone Else\n',
  'pipeline/acme/record.yaml': 'status: Rejected\n',
}

const source = (latest: Partial<EngineSource> = {}): EngineSource => ({
  latestCommit: async () => undefined,
  latestFiles: async () => undefined,
  download: async (dest) => {
    cpSync(upstream(), join(dest, 'job-coach-main'), { recursive: true })
    return join(dest, 'job-coach-main')
  },
  ...latest,
})

// Records each command; the record check fails when told to, before or after the update.
const runner = (fails: (call: number) => boolean = () => false) => {
  const calls: string[] = []
  const run: Run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    return { ok: !fails(calls.length), output: 'pipeline/acme: status is not a known status' }
  }
  return { run, calls }
}

const now = new Date('2026-10-29T09:00:00Z')

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

describe('checkForUpdate', () => {
  const blobIds = (base: string, files: Record<string, string>) =>
    new Map(
      Object.keys(files).map((rel) => [
        rel,
        execFileSync('git', ['hash-object', join(base, rel)], { encoding: 'utf8' }).trim(),
      ]),
    )

  it('asks at most once a week, even when the answer was unknown', async () => {
    mkdirSync(work())
    let asked = 0
    const counting = source({
      latestFiles: async () => {
        asked++
      },
    })
    const at = (day: string) => checkForUpdate(work(), { now: new Date(day), source: counting })
    expect(await at('2026-10-29T09:00:00Z')).toBe('unknown')
    expect(await at('2026-11-04T09:00:00Z')).toBe('not-due')
    expect(await at('2026-11-05T09:00:00Z')).toBe('unknown')
    expect(asked).toBe(2)
    const forced = await checkForUpdate(work(), { now, source: counting, force: true })
    expect(forced).toBe('unknown')
    expect(asked).toBe(3)
  })

  it('compares file contents in a folder that keeps no history', async () => {
    put(work(), { ...DATA, ...OLD_ENGINE })
    // Upstream's own data paths differ from the user's, and must not count.
    const same = blobIds(work(), OLD_ENGINE)
    same.set('profile/identity.yaml', '0'.repeat(40))
    const unchanged = source({ latestFiles: async () => same })
    expect(await checkForUpdate(work(), { now, source: unchanged, force: true })).toBe('latest')

    put(upstream(), NEW_ENGINE)
    const newer = source({ latestFiles: async () => blobIds(upstream(), NEW_ENGINE) })
    expect(await checkForUpdate(work(), { now, source: newer, force: true })).toBe('available')
  })

  it('compares commits in a folder that keeps history', async () => {
    put(work(), OLD_ENGINE)
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', work(), ...args], { encoding: 'utf8' }).trim()
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'engine')
    const head = git('rev-parse', 'HEAD')
    const at = (sha: string) =>
      checkForUpdate(work(), {
        now,
        source: source({ latestCommit: async () => sha }),
        force: true,
      })
    expect(await at(head)).toBe('latest')
    expect(await at('1'.repeat(40))).toBe('available')
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
