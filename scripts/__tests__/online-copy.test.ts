import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onlineCopy, type Seams } from '../lib/online-copy.ts'

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

describe('onlineCopy with the real gh and git', () => {
  it('asks about origin, not the upstream remote gh would pick by default', async () => {
    addRemote('origin', 'git@github.com:someone/my-copy.git')
    addRemote('upstream', 'https://github.com/someone/job-coach.git')
    expect(await onlineCopy(dir)).toBe('private')
  })

  it('reports a public origin', async () => {
    addRemote('origin', 'https://github.com/someone/public-copy.git')
    expect(await onlineCopy(dir)).toBe('public')
  })

  it('finds no online copy without an origin, even when upstream is set', async () => {
    addRemote('upstream', 'https://github.com/someone/job-coach.git')
    expect(await onlineCopy(dir)).toBe('none')
  })
})

// Fakes for the outside world, so no test needs gh, a remote or the network.
const seams = (over: Partial<Seams>): Seams => ({
  origin: () => 'https://github.com/someone/my-copy.git',
  gh: () => undefined,
  api: async () => undefined,
  ...over,
})
const unreachable = async (): Promise<number | undefined> => {
  throw new Error('GitHub must not be asked')
}

describe('onlineCopy: the six kinds', () => {
  it('is none without an origin', async () => {
    expect(await onlineCopy('.', seams({ origin: () => undefined }))).toBe('none')
  })

  it('is the engine for the engine repo, in any URL form, without asking GitHub', async () => {
    for (const origin of [
      'https://github.com/leonardoazeredo/job-coach.git',
      'git@github.com:LeonardoAzeredo/Job-Coach.git',
    ])
      expect(
        await onlineCopy(
          '.',
          seams({ origin: () => origin, gh: () => 'PRIVATE', api: unreachable }),
        ),
      ).toBe('engine')
  })

  it('is public when gh says so, without calling the API', async () => {
    expect(await onlineCopy('.', seams({ gh: () => 'PUBLIC', api: unreachable }))).toBe('public')
  })

  it('is private when gh says private, and when it says internal', async () => {
    expect(await onlineCopy('.', seams({ gh: () => 'PRIVATE', api: unreachable }))).toBe('private')
    expect(await onlineCopy('.', seams({ gh: () => 'INTERNAL', api: unreachable }))).toBe('private')
  })

  it('falls back to the API when gh is absent: 200 is public, 404 is private', async () => {
    expect(await onlineCopy('.', seams({ api: async () => 200 }))).toBe('public')
    expect(await onlineCopy('.', seams({ api: async () => 404 }))).toBe('private')
  })

  it('is unknown when GitHub does not answer: offline or rate limited', async () => {
    expect(await onlineCopy('.', seams({ api: async () => undefined }))).toBe('unknown')
    expect(await onlineCopy('.', seams({ api: async () => 403 }))).toBe('unknown')
  })

  it('is unknown for a GitHub address it cannot read, without asking GitHub', async () => {
    const origin = () => 'https://github.com/someone'
    expect(await onlineCopy('.', seams({ origin, gh: () => 'PUBLIC', api: unreachable }))).toBe(
      'unknown',
    )
  })

  it('is elsewhere for an origin that is not on GitHub, without asking GitHub', async () => {
    const origin = () => 'https://example.com/me/copy.git'
    expect(await onlineCopy('.', seams({ origin, gh: () => 'PUBLIC', api: unreachable }))).toBe(
      'elsewhere',
    )
  })
})
