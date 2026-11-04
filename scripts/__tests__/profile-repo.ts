import { afterEach, beforeEach } from 'vitest'
import { parse } from 'yaml'
import { profileCommand } from '../profile.ts'
import { type TempRepo, tempRepo } from './temp-repo.ts'

// useProfileRepo() makes this fresh for every test in the file that calls it, so read it
// inside a test or hook: a copy taken while the file loads is undefined.
export let repo: TempRepo
export const useProfileRepo = () => {
  beforeEach(() => {
    repo = tempRepo()
  })
  afterEach(() => repo.dispose())
}

const NOW = new Date('2026-11-03T10:00:00Z')

// Runs profile.ts in-process with `input` on stdin, as text or as JSON values.
export const run = (args: string[], input?: unknown) =>
  repo.runAtRoot(
    (a, root) =>
      profileCommand(a, root, {
        now: NOW,
        stdin: async () => (typeof input === 'string' ? input : JSON.stringify(input)),
      }),
    ...args,
  )
export const draft = (file: string, input: unknown) => run(['draft', file], input)
export const write = (...files: string[]) => run(['write', ...files])
export const personaFile = (rel: string) => parse(repo.read(rel))
export const drafted = (file: string) => repo.read(`.coach/drafts/${file}`)
