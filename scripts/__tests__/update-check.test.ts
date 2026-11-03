import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, SourceFault } from '../lib/update.ts'
import {
  DATA,
  NEW_ENGINE,
  now,
  OLD_ENGINE,
  put,
  read,
  source,
  upstream,
  work,
} from './update-helpers.ts'

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

describe('checkForUpdate', () => {
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
})

describe('checkForUpdate state file', () => {
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
})

describe('checkForUpdate sources', () => {
  const blobIds = (base: string, files: Record<string, string>) =>
    new Map(
      Object.keys(files).map((rel) => [
        rel,
        execFileSync('git', ['hash-object', join(base, rel)], { encoding: 'utf8' }).trim(),
      ]),
    )

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
