import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitHubEngine, SourceFault, type UnknownReason } from '../lib/update.ts'
import { updateCommand } from '../update.ts'
import { now, OLD_ENGINE, put, source, work } from './update-helpers.ts'

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

describe('updateCommand check', () => {
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
})
