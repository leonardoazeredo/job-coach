import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ghVisibility } from '../lib/repo-visibility.ts'

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

describe('ghVisibility', () => {
  it('asks about origin, not the upstream remote gh would pick by default', () => {
    addRemote('origin', 'git@github.com:someone/my-copy.git')
    addRemote('upstream', 'https://github.com/someone/job-coach.git')
    expect(ghVisibility(dir)).toBe('private')
  })

  it('reports a public origin', () => {
    addRemote('origin', 'https://github.com/someone/public-copy.git')
    expect(ghVisibility(dir)).toBe('public')
  })

  it('cannot tell without an origin, even when upstream is set', () => {
    addRemote('upstream', 'https://github.com/someone/job-coach.git')
    expect(ghVisibility(dir)).toBeUndefined()
  })
})
