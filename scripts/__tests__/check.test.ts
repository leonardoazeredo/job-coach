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

const runCheck = (visibility: () => RepoVisibility | undefined) =>
  repo.run((args) => check(args, openWorkspace(repo.path('.'), visibility)))

describe('check and repo visibility', () => {
  it('warns, without failing, when the repo is public', async () => {
    const run = await runCheck(() => 'public')
    expect(run.code).toBe(0)
    expect(run.stdout).toMatch(/warn {3}repo: this repository is public/)
  })

  it('says nothing when the repo is private', async () => {
    const run = await runCheck(() => 'private')
    expect(run.code).toBe(0)
    expect(run.stdout).not.toMatch(/public/)
  })

  it('says nothing when the visibility cannot be told, such as without gh or a remote', async () => {
    const run = await runCheck(() => undefined)
    expect(run.code).toBe(0)
    expect(run.stdout).not.toMatch(/public/)
  })
})
