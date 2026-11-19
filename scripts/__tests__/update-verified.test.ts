import { describe, expect, it } from 'vitest'
import { gitIn } from '../lib/history.ts'
import { updateFromArchive } from '../lib/update.ts'
import { engineChanges, finishUpdate, mergeEngine } from '../lib/update-git.ts'
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

const scenarios = {
  'a folder with no history (zip)': async () => {
    put(work(), { ...DATA, ...OLD_ENGINE })
    put(upstream(), { ...OLD_ENGINE, 'CLAUDE.md': NEW_PROMPT })
    const { run } = runner(zipFailsAfter)
    return updateFromArchive(work(), { now, source: source(), run })
  },
  'a folder with history (merge)': async () => {
    cloned()
    engineCommit({ 'CLAUDE.md': NEW_PROMPT }, 'Sharper prompt')
    const git = gitIn(work())
    if (!git) throw new Error('no git')
    engineChanges(git, { url: upstream() })
    mergeEngine(work(), git, { url: upstream(), run: runner().run })
    return finishUpdate(work(), git, { run: runner(mergeFailsAfter).run })
  },
}

describe('a verified update', () => {
  it.each(Object.entries(scenarios))(
    'is undone when the check fails after it, for %s',
    async (_name, scenario) => {
      const result = await scenario()
      expect(result).toMatchObject({
        kind: 'undone',
        output: 'pipeline/acme: status is not a known status',
      })
      expect(read('CLAUDE.md')).toBe('old prompt\n')
    },
  )
})
