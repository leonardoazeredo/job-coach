import { mkdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { board } from '../board.ts'
import { cvBuild } from '../cv-build.ts'
import { pull } from '../discovery/pull.ts'
import { shortlist } from '../discovery/shortlist.ts'
import { BOARD_NAMES } from '../lib/boards/index.ts'
import type { BoardDeps } from '../lib/listings.ts'
import { EXIT } from '../lib/problem.ts'
import { larkspur, repo, useWorkspaceRepo } from './workspace-repo.ts'

type LooseSearch = { discovery: { [key: string]: unknown; search?: { [key: string]: unknown } } }

useWorkspaceRepo()

describe('board', () => {
  it('takes today from the timezone in profile/identity.yaml', async () => {
    expect((await repo.run(board)).code).toBe(0)
  })

  it('lists onboarding without an identity, and fails on a timezone it cannot read', async () => {
    repo.remove('profile/identity.yaml')
    // A missing identity means onboarding has not reached that step, so it is listed rather than reported.
    const missing = await repo.run(board)
    expect(missing.code).toBe(0)
    expect(missing.stdout).toContain('identity (required)')

    repo.write('profile/identity.yaml', 'name: Dana Okafor\nlocation:\n  timezone: Mars/Olympus\n')
    const unknown = await repo.run(board)
    expect(unknown.code).toBe(EXIT.problems)
    expect(unknown.stderr).toContain('"Mars/Olympus" is not a timezone')
  })

  it('needs no timezone when --today is given', async () => {
    repo.remove('profile/identity.yaml')
    expect((await repo.run(board, '--today=2026-10-27')).code).toBe(0)
  })

  it('still refuses a --today that is not an ISO day', async () => {
    expect((await repo.run(board, '--today=27/10/2026')).code).toBe(EXIT.usage)
  })
})

describe('cv-build', () => {
  it('reports a cv.json it cannot write and returns the problems code', async () => {
    mkdirSync(larkspur.path('cv/cv.json'))
    const run = await repo.run(cvBuild, larkspur.slug)
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr).toMatch(/cv\/cv\.json could not be written: EISDIR/)
    expect(run.stderr).toContain('cv-build: not written; fix the errors above')
  })

  it('reports a missing requirements.yaml and returns the problems code', async () => {
    larkspur.remove('requirements.yaml')
    const run = await repo.run(cvBuild, larkspur.slug)
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr).toContain('requirements.yaml is missing')
    expect(run.stderr).toContain('cv-build: not written; fix the errors above')
  })
})

describe('shortlist', () => {
  // Paths are absolute because a command run in-process resolves them against the test's
  // cwd, not the temp repo.
  let listings: string
  beforeEach(() => {
    repo.write('listings.json', '[]\n')
    listings = repo.path('listings.json')
  })

  it('takes today from the timezone in profile/identity.yaml', async () => {
    expect((await repo.run(shortlist, listings)).code).toBe(0)
  })

  it('fails without a readable timezone, rather than taking the UTC day', async () => {
    repo.remove('profile/identity.yaml')
    const missing = await repo.run(shortlist, listings)
    expect(missing.code).toBe(EXIT.problems)
    expect(missing.stderr).toContain('profile/identity.yaml: is missing')

    repo.write('profile/identity.yaml', 'name: Dana Okafor\nlocation:\n  timezone: Mars/Olympus\n')
    const unknown = await repo.run(shortlist, listings)
    expect(unknown.code).toBe(EXIT.problems)
    expect(unknown.stderr).toContain('"Mars/Olympus" is not a timezone')
  })

  it('needs no timezone when --today is given', async () => {
    repo.remove('profile/identity.yaml')
    expect((await repo.run(shortlist, listings, '--today=2026-10-27')).code).toBe(0)
  })

  it('still refuses a --today that is not an ISO day', async () => {
    expect((await repo.run(shortlist, listings, '--today=27/10/2026')).code).toBe(EXIT.usage)
  })

  it('exits 66 when a pull is missing', async () => {
    const gone = await repo.run(shortlist, repo.path('gone.json'))
    expect(gone.code).toBe(EXIT.missing)
    expect(gone.stderr).toContain('gone.json: is missing')
  })

  it('exits 1 without a stack trace when the shortlist cannot be written', async () => {
    // A folder where the file belongs fails the write the same way a read-only folder
    // does, and unlike chmod it holds when the tests run as root.
    repo.write('shortlist.json/keep', '')
    const out = await repo.run(shortlist, listings)
    expect(out.code).toBe(EXIT.problems)
    expect(out.stderr).toContain('could not be written')
    expect(out.stderr).not.toContain('at writeFileSync')
  })
})

describe.each(BOARD_NAMES)('pull %s', (name) => {
  // Every case breaks the rules, so no board may be reached. A rejected fetch alone would
  // not show, since pull turns it into exit 1, the code these cases expect anyway.
  const requested: string[] = []
  afterEach(() => {
    const made = requested.splice(0)
    expect(made).toEqual([])
  })
  const noNetwork: BoardDeps = {
    fetch: (url) => {
      requested.push(url)
      return Promise.reject(new Error('the network was reached'))
    },
    sleep: () => Promise.resolve(),
    log: () => undefined,
  }
  const runPull = (...args: string[]) =>
    repo.run((a, w) => pull(a, w, noNetwork), name, repo.path('out.json'), ...args)

  it('fails on a search profile without the search preferences', async () => {
    repo.editYaml<LooseSearch>('profile/search.yaml', (r) => {
      delete r.discovery.search
    })
    const run = await runPull()
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr).toMatch(/profile\/search\.yaml: could not be read: discovery\.search/)
  })

  it('fails on a search preference of the wrong type', async () => {
    repo.editYaml<LooseSearch>('profile/search.yaml', (r) => {
      if (r.discovery.search) r.discovery.search.hybrid = 'yes'
    })
    const run = await runPull()
    expect(run.code).toBe(EXIT.problems)
    expect(run.stderr).toMatch(/discovery\.search\.hybrid/)
  })
})
