import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitHubRepo } from '../lib/history.ts'
import { save } from '../lib/save.ts'

let dir: string
let savedEnv: NodeJS.ProcessEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  // A git hook exports GIT_DIR and friends, which would point every git call here at the
  // repo being pushed instead of the temp one.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  // The machine's own git config can add hooks or an identity that the temp repos must not see.
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  dir = mkdtempSync(join(tmpdir(), 'save-'))
})
afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

const work = () => join(dir, 'work')
const git = (...args: string[]) =>
  execFileSync('git', ['-C', work(), ...args], { encoding: 'utf8' }).trim()
const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(work(), rel)), { recursive: true })
  writeFileSync(join(work(), rel), text)
}
const commits = () => Number(git('rev-list', '--count', 'HEAD'))

const checkout = () => {
  mkdirSync(work())
  execFileSync('git', ['init', '-q', '-b', 'main', work()])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('README.md', 'engine\n')
  git('add', '.')
  git('commit', '-q', '-m', 'engine')
}

const neverPublic = async () => false

describe('save', () => {
  it('commits the data folders with the message, and leaves engine edits alone', async () => {
    checkout()
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    write('README.md', 'edited engine\n')
    const result = await save(work(), { message: 'Recorded: applied to Acme', probe: neverPublic })
    expect(result).toEqual({ kind: 'saved', online: 'no-copy' })
    expect(commits()).toBe(2)
    expect(git('log', '-1', '--format=%s')).toBe('Recorded: applied to Acme')
    expect(git('status', '--porcelain')).toBe('M README.md')
  })

  it('saves engine edits too with everything', async () => {
    checkout()
    write('README.md', 'edited engine\n')
    await save(work(), { message: 'Saved before updating', everything: true, probe: neverPublic })
    expect(git('status', '--porcelain')).toBe('')
  })

  it('saves past a data folder that holds nothing git keeps', async () => {
    checkout()
    mkdirSync(join(work(), 'cv'))
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    const result = await save(work(), { message: 'x', probe: neverPublic })
    expect(result).toEqual({ kind: 'saved', online: 'no-copy' })
    expect(commits()).toBe(2)
  })

  it('commits a renamed role folder whole', async () => {
    checkout()
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    git('add', '.')
    git('commit', '-q', '-m', 'acme')
    git('mv', 'pipeline/acme', 'pipeline/acme-corp')
    await save(work(), { message: 'x', probe: neverPublic })
    expect(git('status', '--porcelain')).toBe('')
    expect(commits()).toBe(3)
  })

  it('makes no commit when nothing changed', async () => {
    checkout()
    expect(await save(work(), { message: 'x', probe: neverPublic })).toEqual({ kind: 'nothing' })
    expect(commits()).toBe(1)
  })

  it('saves nothing in a folder that is not its own checkout', async () => {
    mkdirSync(work())
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    expect(await save(work(), { message: 'x' })).toEqual({ kind: 'no-history' })
  })

  it('saves nothing in a folder unpacked inside another checkout', async () => {
    execFileSync('git', ['init', '-q', dir])
    mkdirSync(work())
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    expect(await save(work(), { message: 'x' })).toEqual({ kind: 'no-history' })
  })

  it('saves nothing when git is not on the path', async () => {
    checkout()
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    const result = await save(work(), { message: 'x', path: join(dir, 'empty-bin') })
    expect(result).toEqual({ kind: 'no-history' })
    expect(commits()).toBe(1)
  })

  it('commits without a configured identity', async () => {
    checkout()
    git('config', '--unset', 'user.email')
    git('config', '--unset', 'user.name')
    write('profile/coach.md', 'hello\n')
    expect((await save(work(), { message: 'x', probe: neverPublic })).kind).toBe('saved')
    expect(git('log', '-1', '--format=%ae')).toBe('job-coach@localhost')
  })

  it('reports a refused save with the check output, and keeps the data written', async () => {
    checkout()
    const hook = join(work(), '.git/hooks/pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "record.yaml: status is not a known status" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    write('pipeline/acme/record.yaml', 'status: Nope\n')
    const result = await save(work(), { message: 'x', probe: neverPublic })
    expect(result).toEqual({ kind: 'refused', output: 'record.yaml: status is not a known status' })
    expect(commits()).toBe(1)
  })

  describe('online copy', () => {
    const withOrigin = (url: string) => {
      checkout()
      git('remote', 'add', 'origin', url)
      write('pipeline/acme/record.yaml', 'status: Applied\n')
    }

    it('pushes to a private online copy', async () => {
      execFileSync('git', ['init', '-q', '--bare', join(dir, 'online.git')])
      withOrigin(join(dir, 'online.git'))
      const result = await save(work(), { message: 'x', probe: neverPublic })
      expect(result).toEqual({ kind: 'saved', online: 'pushed' })
      expect(
        execFileSync('git', ['-C', join(dir, 'online.git'), 'log', '-1', '--format=%s', 'main'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('x')
    })

    it('never pushes to a copy GitHub reports as public', async () => {
      withOrigin('git@github.com:someone/my-copy.git')
      const asked: string[] = []
      const probe = async (repo: string) => {
        asked.push(repo)
        return true
      }
      expect(await save(work(), { message: 'x', probe })).toEqual({
        kind: 'saved',
        online: 'public',
      })
      expect(asked).toEqual(['someone/my-copy'])
    })

    it('never pushes to the engine, without asking GitHub', async () => {
      withOrigin('https://github.com/leonardoazeredo/job-coach.git')
      const probe = async () => {
        throw new Error('not asked')
      }
      expect(await save(work(), { message: 'x', probe })).toEqual({
        kind: 'saved',
        online: 'public',
      })
    })

    it('holds the push when GitHub cannot say whether the copy is public', async () => {
      execFileSync('git', ['init', '-q', '--bare', join(dir, 'online.git')])
      withOrigin('git@github.com:someone/my-copy.git')
      git('remote', 'set-url', '--push', 'origin', join(dir, 'online.git'))
      const result = await save(work(), { message: 'x', probe: async () => undefined })
      expect(result).toEqual({ kind: 'saved', online: 'unchecked' })
      expect(
        execFileSync('git', ['-C', join(dir, 'online.git'), 'rev-list', '--all'], {
          encoding: 'utf8',
        }),
      ).toBe('')
    })

    it('never pushes to a GitHub address it cannot read', async () => {
      withOrigin('https://github.com/someone')
      const probe = async () => {
        throw new Error('not asked')
      }
      expect(await save(work(), { message: 'x', probe })).toEqual({
        kind: 'saved',
        online: 'unchecked',
      })
    })

    it('reports a failed push with its output, keeping the local save', async () => {
      withOrigin(join(dir, 'missing.git'))
      const result = await save(work(), { message: 'x', probe: neverPublic })
      expect(result).toMatchObject({ kind: 'saved', online: 'failed' })
      expect(commits()).toBe(2)
    })
  })
})

describe('gitHubRepo', () => {
  it('reads owner/name from the GitHub URL forms git accepts', () => {
    expect(gitHubRepo('git@github.com:someone/my-copy.git')).toBe('someone/my-copy')
    expect(gitHubRepo('https://github.com/someone/my-copy.git\n')).toBe('someone/my-copy')
    expect(gitHubRepo('https://github.com/someone/my-copy')).toBe('someone/my-copy')
    expect(gitHubRepo('ssh://git@github.com/someone/my-copy.git')).toBe('someone/my-copy')
    expect(gitHubRepo('ssh://git@github.com:22/someone/my-copy.git')).toBe('someone/my-copy')
    expect(gitHubRepo('https://gitlab.com/someone/my-copy.git')).toBeUndefined()
    expect(gitHubRepo('https://notgithub.com/someone/my-copy.git')).toBeUndefined()
  })
})
