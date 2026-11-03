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
  gitHubEngine,
  isEngineFile,
  type Run,
  SourceFault,
  type UnknownReason,
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
  'profile/glossary.md': '**Target company**:\nA company Mira names.\n',
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
  'profile/glossary.md': 'upstream term\n',
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

  const state = () => JSON.parse(read('.coach/state.json'))
  const failing = (reason: 'offline' | 'rate-limited' | 'unexpected') => {
    const counter = { asked: 0 }
    const src = source({
      latestFiles: async () => {
        counter.asked++
        throw new SourceFault(reason)
      },
    })
    return { counter, src }
  }

  it.each(['offline', 'rate-limited', 'unexpected'] as const)(
    'reports %s as unknown with its reason',
    async (reason) => {
      mkdirSync(work())
      const { src } = failing(reason)
      expect(await checkForUpdate(work(), { now, source: src })).toEqual({
        kind: 'unknown',
        reason,
      })
    },
  )

  it('reports a source that has no data as an unexpected reply', async () => {
    mkdirSync(work())
    expect(await checkForUpdate(work(), { now, source: source() })).toEqual({
      kind: 'unknown',
      reason: 'unexpected',
    })
  })

  it('stores no check date after a failure and retries at most once a day', async () => {
    mkdirSync(work())
    const { counter, src } = failing('offline')
    const at = (time: string) => checkForUpdate(work(), { now: new Date(time), source: src })
    expect(await at('2026-10-29T09:00:00Z')).toMatchObject({ kind: 'unknown' })
    expect(state().lastUpdateCheck).toBeUndefined()
    expect(await at('2026-10-30T08:00:00Z')).toBe('not-due')
    expect(counter.asked).toBe(1)
    expect(await at('2026-10-30T09:00:00Z')).toMatchObject({ kind: 'unknown' })
    expect(counter.asked).toBe(2)
    const forced = await checkForUpdate(work(), { now, source: src, force: true })
    expect(forced).toMatchObject({ kind: 'unknown' })
    expect(counter.asked).toBe(3)
  })

  it('asks at most once a week after a definite answer', async () => {
    mkdirSync(work())
    let asked = 0
    const counting = source({
      latestFiles: async () => {
        asked++
        return new Map()
      },
    })
    const at = (day: string) => checkForUpdate(work(), { now: new Date(day), source: counting })
    expect(await at('2026-10-29T09:00:00Z')).toBe('latest')
    expect(await at('2026-11-04T09:00:00Z')).toBe('not-due')
    expect(await at('2026-11-05T09:00:00Z')).toBe('latest')
    expect(asked).toBe(2)
  })

  it('clears the failed attempt after a success', async () => {
    mkdirSync(work())
    await checkForUpdate(work(), { now, source: failing('offline').src })
    expect(state().lastUpdateAttempt).toBeDefined()
    const ok = source({ latestFiles: async () => new Map() })
    expect(await checkForUpdate(work(), { now, source: ok, force: true })).toBe('latest')
    expect(state().lastUpdateAttempt).toBeUndefined()
    expect(state().lastUpdateCheck).toBe(now.toISOString())
  })

  it('treats a missing state file as never checked, silently', async () => {
    mkdirSync(work())
    const reset = vi.fn()
    const ok = source({ latestFiles: async () => new Map() })
    await checkForUpdate(work(), { now, source: ok, onStateReset: reset })
    expect(reset).not.toHaveBeenCalled()
  })

  it('checks and reports an unparseable state file as reset', async () => {
    mkdirSync(join(work(), '.coach'), { recursive: true })
    writeFileSync(join(work(), '.coach/state.json'), '{not json')
    const reset = vi.fn()
    const ok = source({ latestFiles: async () => new Map() })
    expect(await checkForUpdate(work(), { now, source: ok, onStateReset: reset })).toBe('latest')
    expect(reset).toHaveBeenCalledTimes(1)
    expect(state().lastUpdateCheck).toBe(now.toISOString())
  })

  it('does not crash when the state file cannot be written', async () => {
    mkdirSync(work())
    writeFileSync(join(work(), '.coach'), 'a file where the folder should be')
    const ok = source({ latestFiles: async () => new Map() })
    expect(await checkForUpdate(work(), { now, source: ok })).toBe('latest')
  })

  it('keeps unknown keys in the state file across a check', async () => {
    mkdirSync(join(work(), '.coach'), { recursive: true })
    writeFileSync(
      join(work(), '.coach/state.json'),
      JSON.stringify({ lastUpdateCheck: '2026-10-01T00:00:00Z', other: 'kept' }),
    )
    const ok = source({ latestFiles: async () => new Map() })
    await checkForUpdate(work(), { now, source: ok })
    expect(state().other).toBe('kept')
    expect(state().lastUpdateCheck).toBe(now.toISOString())
  })

  it('treats a malformed lastUpdateCheck as not yet checked', async () => {
    mkdirSync(join(work(), '.coach'), { recursive: true })
    writeFileSync(
      join(work(), '.coach/state.json'),
      JSON.stringify({ lastUpdateCheck: 42, other: 'kept' }),
    )
    const counting = source({
      latestFiles: async () => {
        asked++
        return new Map()
      },
    })
    let asked = 0
    const reset = vi.fn()
    expect(await checkForUpdate(work(), { now, source: counting, onStateReset: reset })).toBe(
      'latest',
    )
    expect(asked).toBe(1)
    expect(reset).not.toHaveBeenCalled()
    expect(state().other).toBe('kept')
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

describe('gitHubEngine', () => {
  afterEach(() => vi.unstubAllGlobals())
  const reply = (init: ResponseInit, body = '{}') =>
    vi.stubGlobal('fetch', async () => new Response(body, init))

  it('tells a network failure from a rate limit from a reply it cannot read', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(gitHubEngine.latestCommit()).rejects.toMatchObject({ reason: 'offline' })
    reply({ status: 403, headers: { 'x-ratelimit-remaining': '0' } })
    await expect(gitHubEngine.latestCommit()).rejects.toMatchObject({ reason: 'rate-limited' })
    reply({ status: 429 })
    await expect(gitHubEngine.latestFiles()).rejects.toMatchObject({ reason: 'rate-limited' })
    reply({ status: 404 })
    await expect(gitHubEngine.latestCommit()).rejects.toMatchObject({ reason: 'unexpected' })
    reply({ status: 200 }, '<html>')
    await expect(gitHubEngine.latestCommit()).rejects.toMatchObject({ reason: 'unexpected' })
    reply({ status: 200 }, '{"sha":7}')
    await expect(gitHubEngine.latestCommit()).rejects.toMatchObject({ reason: 'unexpected' })
  })

  it('returns the newest commit from a good reply', async () => {
    reply({ status: 200 }, '{"sha":"abc"}')
    expect(await gitHubEngine.latestCommit()).toBe('abc')
  })
})

describe('updateCommand', () => {
  const printed = async (args: string[], deps: Parameters<typeof updateCommand>[2]) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const code = await updateCommand(args, work(), deps)
    const lines = log.mock.calls.map((c) => c[0])
    log.mockRestore()
    return { code, lines }
  }

  it('prints one plain line and exits 0 when the check cannot get an answer', async () => {
    mkdirSync(work())
    const reasons: [UnknownReason, RegExp][] = [
      ['offline', /internet/],
      ['rate-limited', /busy/],
      ['unexpected', /read/],
    ]
    for (const [reason, words] of reasons) {
      rmSync(join(work(), '.coach'), { recursive: true, force: true })
      const src = source({
        latestFiles: async () => {
          throw new SourceFault(reason)
        },
      })
      const { code, lines } = await printed(['check'], { now, source: src })
      expect(code).toBe(0)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(words)
      expect(lines[0]).not.toMatch(/API|HTTP|JSON|GitHub/)
    }
  })

  it('prints available when an update exists and nothing for latest or not-due', async () => {
    put(work(), OLD_ENGINE)
    const ids = new Map([['CLAUDE.md', '0'.repeat(40)]])
    const newer = source({ latestFiles: async () => ids })
    expect((await printed(['check'], { now, source: newer })).lines).toEqual(['available'])
    expect((await printed(['check'], { now, source: newer })).lines).toEqual([])
    const same = source({ latestFiles: async () => new Map() })
    rmSync(join(work(), '.coach'), { recursive: true })
    expect((await printed(['check'], { now, source: same })).lines).toEqual([])
  })

  it('says the record of the last check was reset when the state file is damaged', async () => {
    mkdirSync(join(work(), '.coach'), { recursive: true })
    writeFileSync(join(work(), '.coach/state.json'), '{not json')
    const same = source({ latestFiles: async () => new Map() })
    const { code, lines } = await printed(['check'], { now, source: same })
    expect(code).toBe(0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/damaged/)
  })

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
