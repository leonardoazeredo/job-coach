import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { save } from '../lib/save.ts'
import { saveCommand } from '../save.ts'
import { checkout, commits, dir, git, neverPublic, work, write } from './save-helpers.ts'

describe('save with nothing new to commit', () => {
  const bare = () => join(dir, 'online.git')
  const onlineLog = () =>
    execFileSync('git', ['-C', bare(), 'rev-list', '--all'], { encoding: 'utf8' }).trim()
  // A clean folder whose history is ahead of its online copy, as after an update's merge commit.
  const ahead = (origin: string, pushUrl?: string) => {
    checkout()
    execFileSync('git', ['init', '-q', '--bare', bare()])
    git('remote', 'add', 'origin', origin)
    if (pushUrl) git('remote', 'set-url', '--push', 'origin', pushUrl)
    git('push', '-q', pushUrl ?? origin, 'main')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    write('pipeline/acme/record.yaml', 'status: Applied\n')
    git('add', '.')
    git('commit', '-q', '-m', 'merge')
  }
  const noop = () => undefined

  it('sends commits the online copy lacks to a private online copy', async () => {
    ahead(bare())
    const result = await save(work(), { message: 'x', probe: neverPublic })
    expect(result).toEqual({ kind: 'saved', online: 'pushed' })
    expect(onlineLog()).toBe(git('rev-list', 'HEAD'))
    expect(commits()).toBe(2)
  })

  it('never pushes to a copy GitHub reports as public', async () => {
    ahead('git@github.com:someone/my-copy.git', bare())
    const before = onlineLog()
    const result = await save(work(), { message: 'x', probe: async () => true })
    expect(result).toEqual({ kind: 'saved', online: 'public' })
    expect(onlineLog()).toBe(before)
  })

  it('holds the push when GitHub cannot say whether the copy is public', async () => {
    ahead('git@github.com:someone/my-copy.git', bare())
    const before = onlineLog()
    const result = await save(work(), { message: 'x', probe: async () => undefined })
    expect(result).toEqual({ kind: 'saved', online: 'unchecked' })
    expect(onlineLog()).toBe(before)
  })

  it('never pushes to the engine', async () => {
    ahead('https://github.com/leonardoazeredo/job-coach.git', bare())
    const before = onlineLog()
    const result = await save(work(), { message: 'x', probe: neverPublic })
    expect(result).toEqual({ kind: 'saved', online: 'public' })
    expect(onlineLog()).toBe(before)
  })

  it('reports nothing, and asks nobody, when not ahead of the online copy', async () => {
    ahead(bare())
    await save(work(), { message: 'x', probe: neverPublic })
    const probe = async () => {
      throw new Error('not asked')
    }
    expect(await save(work(), { message: 'x', probe })).toEqual({ kind: 'nothing' })
  })

  it('reports nothing for a clean folder with no online copy', async () => {
    checkout()
    expect(await save(work(), { message: 'x', probe: neverPublic })).toEqual({ kind: 'nothing' })
  })

  it('exits 1 on a failed push, with the failed line and the push output', async () => {
    ahead(bare())
    git('remote', 'set-url', 'origin', join(dir, 'missing.git'))
    const log = vi.spyOn(console, 'log').mockImplementation(noop)
    const err = vi.spyOn(console, 'error').mockImplementation(noop)
    try {
      const code = await saveCommand(['x'], work(), { probe: neverPublic })
      expect(code).toBe(1)
      expect(log).toHaveBeenCalledWith('saved on this computer; updating the online copy failed')
      expect(String(err.mock.calls[0]?.[0])).not.toBe('')
    } finally {
      log.mockRestore()
      err.mockRestore()
    }
  })
})
