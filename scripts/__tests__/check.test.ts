import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { check } from '../check.ts'
import type { OnlineCopy } from '../lib/online-copy.ts'
import { openWorkspace } from '../lib/workspace.ts'
import { type TempRepo, tempRepo } from './temp-repo.ts'

let repo: TempRepo
beforeEach(() => {
  repo = tempRepo()
})
afterEach(() => repo.dispose())

const runCheck = (copy: OnlineCopy | (() => Promise<OnlineCopy>)) =>
  repo.run((args) =>
    check(
      args,
      openWorkspace(repo.path('.'), typeof copy === 'function' ? copy : async () => copy),
    ),
  )

describe('check and the online copy', () => {
  it.each(['public', 'engine'] as const)(
    'warns, without failing, when the online copy is %s',
    async (copy) => {
      const run = await runCheck(copy)
      expect(run.code).toBe(0)
      expect(run.stdout).toMatch(/warn {3}profile: the online copy of this folder is public/)
    },
  )

  it.each(['private', 'none', 'unknown', 'elsewhere'] as const)(
    'says nothing when the online copy is %s',
    async (copy) => {
      const run = await runCheck(copy)
      expect(run.code).toBe(0)
      expect(run.stdout).not.toMatch(/public/)
    },
  )
})
