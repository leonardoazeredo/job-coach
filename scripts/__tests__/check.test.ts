import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { check } from '../check.ts'
import type { RepoVisibility } from '../lib/repo-visibility.ts'
import { openWorkspace } from '../lib/workspace.ts'
import { type TempRepo, tempRepo } from './temp-repo.ts'

let repo: TempRepo
beforeEach(() => {
  repo = tempRepo()
})
afterEach(() => repo.dispose())

const runCheck = (visibility: () => Promise<RepoVisibility | undefined>) =>
  repo.run((args) => check(args, openWorkspace(repo.path('.'), visibility)))

describe('check and repo visibility', () => {
  it('warns, without failing, when the online copy is public', async () => {
    const run = await runCheck(async () => 'public')
    expect(run.code).toBe(0)
    expect(run.stdout).toMatch(/warn {3}profile: the online copy of this folder is public/)
  })

  it('says nothing when the online copy is private', async () => {
    const run = await runCheck(async () => 'private')
    expect(run.code).toBe(0)
    expect(run.stdout).not.toMatch(/public/)
  })

  it('says nothing when the visibility cannot be told, such as without gh or a remote', async () => {
    const run = await runCheck(async () => undefined)
    expect(run.code).toBe(0)
    expect(run.stdout).not.toMatch(/public/)
  })
})
