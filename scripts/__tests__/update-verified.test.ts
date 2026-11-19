import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitIn } from '../lib/history.ts'
import { updateFromArchive } from '../lib/update.ts'
import { engineChanges, finishUpdate, mergeEngine } from '../lib/update-git.ts'
import type { Run } from '../lib/verified-update.ts'
import {
  cloned,
  DATA,
  engineCommit,
  now,
  OLD_ENGINE,
  put,
  read,
  runner,
  source,
  upstream,
  work,
} from './update-helpers.ts'

// The rule is the same for both ways of updating: a check that fails once the new version is in
// place puts the old one back, whichever way the new one arrived.
const NEW_PROMPT = 'new prompt\n'
// The zip update checks once before it starts, so its second check is the one after.
const zipFailsAfter = (call: number) => call === 2
const mergeFailsAfter = (call: number) => call === 1

// The record check as the updaters run it; each updater's calls are compared with two of these.
const CHECK = 'node scripts/check.ts'

// A failed restore: the zip backup is gone, and git's reset refuses to overwrite a changed file.
const scenarios = {
  'a folder with no history (zip)': async (undoBreaks: boolean) => {
    put(work(), { ...DATA, ...OLD_ENGINE })
    put(upstream(), { ...OLD_ENGINE, 'CLAUDE.md': NEW_PROMPT })
    const { run, calls } = runner(zipFailsAfter)
    const breaking: Run = (cmd, args) => {
      const ran = run(cmd, args)
      if (undoBreaks && calls.length === 2)
        rmSync(join(work(), '.coach/backups'), { recursive: true })
      return ran
    }
    return {
      result: await updateFromArchive(work(), { now, source: source(), run: breaking }),
      calls,
    }
  },
  'a folder with history (merge)': async (undoBreaks: boolean) => {
    cloned()
    engineCommit({ 'CLAUDE.md': NEW_PROMPT }, 'Sharper prompt')
    const git = gitIn(work())
    if (!git) throw new Error('no git')
    engineChanges(git, { url: upstream() })
    const merge = runner()
    mergeEngine(work(), git, { url: upstream(), run: merge.run })
    const finish = runner(mergeFailsAfter)
    const breaking: Run = (cmd, args) => {
      const ran = finish.run(cmd, args)
      if (undoBreaks) writeFileSync(join(work(), 'CLAUDE.md'), 'edited meanwhile\n')
      return ran
    }
    const result = finishUpdate(work(), git, { run: breaking })
    return { result, calls: [...merge.calls, ...finish.calls] }
  },
}

describe('a verified update', () => {
  it.each(Object.entries(scenarios))(
    'is undone when the check fails after it, for %s',
    async (_name, scenario) => {
      const { result, calls } = await scenario(false)
      expect(result).toMatchObject({
        kind: 'undone',
        output: 'pipeline/acme: status is not a known status',
      })
      expect(read('CLAUDE.md')).toBe('old prompt\n')
      expect(calls).toEqual([CHECK, CHECK])
    },
  )

  it.each(Object.entries(scenarios))(
    'is reported not undone when the old version cannot be put back, for %s',
    async (name, scenario) => {
      const { result } = await scenario(true)
      expect(result.kind).toBe('not-undone')
      if (!('output' in result)) throw new Error(result.kind)
      // The check's own output, then the reason the old version could not be put back.
      expect(result.output).toContain('pipeline/acme: status is not a known status')
      expect(result.output).toMatch(name.includes('zip') ? /ENOENT/ : /CLAUDE\.md/)
    },
  )
})
