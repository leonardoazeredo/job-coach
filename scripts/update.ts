// Engine updates for the update-coach skill.
// Usage: node scripts/update.ts check [--now]
//        node scripts/update.ts zip
// check asks GitHub once whether a newer engine exists. Without --now it runs at most once a
// week and prints only "available"; with --now it always asks and prints its answer.
// zip updates a folder that keeps no history: it copies the newest engine files over this one,
// backing up each file it replaces, and undoes the update if the install or the record check
// then fails.
// zip prints one line: latest, updated (counts, backup folder and, when any, the replaced settings
// under config/), not started, not fetched or undone.
// Exit 64 on a usage error, or zip in a folder that keeps history (that one updates with git).
// Exit 1 when zip did not start, was undone or could not fetch the new version, with the reason
// on stderr. Otherwise 0.
import { gitIn } from './lib/history.ts'
import { EXIT } from './lib/problem.ts'
import {
  checkForUpdate,
  type EngineSource,
  gitHubEngine,
  type Run,
  updateFromArchive,
} from './lib/update.ts'
import { repoRoot } from './lib/workspace.ts'

const USAGE = 'usage: node scripts/update.ts check [--now] | zip'

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
    const force = rest.includes('--now')
    const result = await checkForUpdate(root, { now, source, force, path: deps.path })
    if (result === 'available' || force) console.log(result)
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
