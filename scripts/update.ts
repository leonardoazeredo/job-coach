// Engine updates for the update-coach skill.
// Usage: node scripts/update.ts check [--now]
//        node scripts/update.ts zip
// check asks GitHub once whether a newer engine exists. Without --now it runs at most once a
// week (once a day after a failed try) and prints "available" or, when it got no answer, one plain
// line saying so; with --now it always asks and prints its answer.
// zip updates a folder that keeps no history: it copies the newest engine files over this one,
// backing up each file it replaces, and undoes the update if the install or the record check
// then fails.
// zip prints one line: latest, updated (counts, backup folder and, when any, the replaced settings
// under config/), not started, not fetched or undone.
// Exit 64 on a usage error, or zip in a folder that keeps history (that one updates with git).
// Exit 1 when zip did not start, was undone or could not fetch the new version, with the reason
// on stderr. Otherwise 0, including a check that got no answer.
import { gitIn } from './lib/history.ts'
import { EXIT } from './lib/problem.ts'
import {
  type CheckOptions,
  checkForUpdate,
  type EngineSource,
  gitHubEngine,
  type Run,
  type UnknownReason,
  updateFromArchive,
} from './lib/update.ts'
import { repoRoot } from './lib/workspace.ts'

const USAGE = 'usage: node scripts/update.ts check [--now] | zip'

// Read by the coach and passed on to the user, so no technical words.
const NO_ANSWER: Record<UnknownReason, string> = {
  offline:
    'The coach could not reach the internet to look for a new version; it will try again tomorrow.',
  'rate-limited':
    'The coach could not look for a new version because the update service is busy; it will try again tomorrow.',
  unexpected:
    'The coach could not read the answer when it looked for a new version; it will try again tomorrow.',
}
const STATE_RESET =
  "The coach's record of when it last looked for a new version was damaged, so it was reset."

const printCheck = async (root: string, opts: CheckOptions) => {
  let reset = false
  const result = await checkForUpdate(root, {
    ...opts,
    onStateReset: () => {
      reset = true
    },
  })
  // One line at most, so the coach can act on it: the reset notice only fills a silence.
  if (typeof result === 'object') console.log(NO_ANSWER[result.reason])
  else if (result === 'available' || opts.force) console.log(result)
  else if (reset) console.log(STATE_RESET)
}

export type UpdateDeps = { now?: Date; source?: EngineSource; path?: string; run?: Run }

export const updateCommand = async (
  args: string[],
  root: string,
  deps: UpdateDeps = {},
): Promise<number> => {
  const now = deps.now ?? new Date()
  const source = deps.source ?? gitHubEngine
  const [sub, ...rest] = args
  if (sub === 'check' && rest.every((a) => a === '--now')) {
    await printCheck(root, { now, source, force: rest.includes('--now'), path: deps.path })
    return 0
  }
  if (sub !== 'zip' || rest.length > 0) {
    console.error(USAGE)
    return EXIT.usage
  }
  if (gitIn(root, deps.path)) {
    console.error('update: this folder keeps history; update it with git (see docs/updating.md)')
    return EXIT.usage
  }
  const result = await updateFromArchive(root, { now, source, run: deps.run })
  switch (result.kind) {
    case 'latest':
      console.log('latest')
      return 0
    case 'updated': {
      // config/ is where a user tunes the coach, and the update overwrites those edits without
      // asking, so each one is named for the user to bring back from the backup.
      const settings = result.replaced.filter((rel) => rel.startsWith('config/'))
      console.log(
        `updated: ${result.replaced.length} replaced, ${result.added.length} added; backup in ${result.backup}${settings.length ? `; settings replaced: ${settings.join(', ')}` : ''}`,
      )
      return 0
    }
    case 'not-started':
      console.log('not started: the record check fails before the update')
      console.error(result.output)
      return EXIT.problems
    case 'not-fetched':
      console.log('not fetched: the new version could not be downloaded; nothing changed')
      console.error(result.output)
      return EXIT.problems
    case 'undone':
      console.log(
        `undone: the install or the record check failed after the update; backup in ${result.backup}`,
      )
      console.error(result.output)
      return EXIT.problems
  }
}

if (import.meta.main) process.exitCode = await updateCommand(process.argv.slice(2), repoRoot())
