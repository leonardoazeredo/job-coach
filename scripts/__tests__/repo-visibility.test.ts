import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { repoVisibility, type Seams, visibilityOfRepo } from '../lib/repo-visibility.ts'

// A fake gh on PATH stands in for GitHub: the user's copy is private, and any other repo,
// including gh's own default when none is named, is public.
const FAKE_GH = `#!/bin/sh
case "$*" in
  *my-copy*) echo PRIVATE ;;
  *) echo PUBLIC ;;
esac
`

let dir: string
let savedEnv: NodeJS.ProcessEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  // A git hook exports GIT_DIR and friends, which would point every git call here at the
  // repo being pushed instead of the temp one.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  dir = mkdtempSync(join(tmpdir(), 'visibility-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`
  execFileSync('git', ['init', '-q', dir])
})
afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

const addRemote = (name: string, url: string) =>
  execFileSync('git', ['-C', dir, 'remote', 'add', name, url])

describe('repoVisibility with the real gh and git', () => {
  it('asks about origin, not the upstream remote gh would pick by default', async () => {
    addRemote('origin', 'git@github.com:someone/my-copy.git')
    addRemote('upstream', 'https://github.com/someone/job-coach.git')
    expect(await repoVisibility(dir)).toBe('private')
  })

  it('reports a public origin', async () => {
    addRemote('origin', 'https://github.com/someone/public-copy.git')
    expect(await repoVisibility(dir)).toBe('public')
  })

  it('cannot tell without an origin, even when upstream is set', async () => {
    addRemote('upstream', 'https://github.com/someone/job-coach.git')
    expect(await repoVisibility(dir)).toBeUndefined()
  })
})

// Fakes for the probes, so no test needs gh, a remote or the network.
const seams = (over: Partial<Seams>): Seams => ({
  origin: () => 'https://github.com/someone/my-copy.git',
  gh: () => undefined,
  api: async () => undefined,
  ...over,
})

describe('visibilityOfRepo', () => {
  it('trusts gh when it answers, without calling the API', async () => {
    const api = async () => {
      throw new Error('api must not be called')
    }
    expect(await visibilityOfRepo('someone/my-copy', seams({ gh: () => 'PUBLIC', api }))).toBe(
      'public',
    )
  })

  it('counts internal as private', async () => {
    expect(await visibilityOfRepo('a/b', seams({ gh: () => 'INTERNAL' }))).toBe('private')
  })

  it('falls back to the API when gh is absent: 200 is public', async () => {
    expect(await visibilityOfRepo('a/b', seams({ api: async () => 200 }))).toBe('public')
  })

  it('falls back to the API when gh is absent: 404 is private', async () => {
    expect(await visibilityOfRepo('a/b', seams({ api: async () => 404 }))).toBe('private')
  })

  it('cannot tell when offline or rate limited', async () => {
    expect(await visibilityOfRepo('a/b', seams({ api: async () => undefined }))).toBeUndefined()
    expect(await visibilityOfRepo('a/b', seams({ api: async () => 403 }))).toBeUndefined()
  })
})

describe('repoVisibility with injected probes', () => {
  it('works without gh for a GitHub origin', async () => {
    expect(await repoVisibility('.', seams({ api: async () => 200 }))).toBe('public')
  })

  it('cannot tell without an origin', async () => {
    expect(await repoVisibility('.', seams({ origin: () => undefined }))).toBeUndefined()
  })

  it('cannot tell for an origin that is not on GitHub', async () => {
    const origin = () => 'https://example.com/me/copy.git'
    expect(await repoVisibility('.', seams({ origin, api: async () => 200 }))).toBeUndefined()
  })
})
