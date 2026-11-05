// Engine updates for the update-coach skill.
// Usage: node scripts/update.ts check [--now]
//        node scripts/update.ts zip
//        node scripts/update.ts changes | merge | take <ours|theirs> <file> | finish | cancel
// check asks GitHub once whether a newer engine exists. Without --now it runs at most once a
// week (once a day after a failed try) and prints "available" or, when it got no answer, one plain
// line saying so; with --now it always asks and prints its answer. Before onboarding has created
// profile/coach.md, check without --now does nothing: a new user has not yet met the coach, and
// an offer to update it would be the first thing they read.
// zip updates a folder that keeps no history: it copies the newest engine files over this one,
// backing up each file it replaces, and undoes the update if the install or the record check
// then fails.
// zip prints one line: latest, updated (counts, backup folder and, when any, the replaced settings
// under config/), not started, not fetched or undone.
// A folder that keeps history updates in steps instead, because a file both the user and the new
// version changed needs the user's choice between turns:
//   changes  connects to the engine, fetches it, and prints latest, or available followed by one
//            "- " line per change, or not fetched.
//   merge    merges the new version and prints merged, clashes: <files>, latest, not fetched (run
//            changes first) or not merged.
//   take     settles one clashing file with the user's version (ours) or the new one (theirs).
//   finish   commits, installs, runs the record check and prints updated, or clashes left when a
//            clash marker remains, or undone when the install or check failed and the folder went
//            back to how it was, or not undone when that putting back failed too.
//   cancel   abandons a merge in progress; nothing changes.
// Exit 64 on a usage error, zip in a folder that keeps history, or a history step in one without.
// Exit 1 when an update did not start, was undone, could not fetch the new version or has clashes
// left, with the reason on stderr. Otherwise 0, including a check that got no answer.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Git, gitIn } from './lib/history.ts'
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
import {
  cancelUpdate,
  engineChanges,
  finishUpdate,
  mergeEngine,
  takeSide,
} from './lib/update-git.ts'
import { repoRoot } from './lib/workspace.ts'

const USAGE =
  'usage: node scripts/update.ts check [--now] | zip | changes | merge | take <ours|theirs> <file> | finish | cancel'

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

export type UpdateDeps = {
  now?: Date
  source?: EngineSource
  path?: string
  run?: Run
  engineUrl?: string
}

const HISTORY_STEPS = ['changes', 'merge', 'take', 'finish', 'cancel']

const historyStep = (git: Git, root: string, args: string[], deps: UpdateDeps): number => {
  const [sub, ...rest] = args
  const opts = { url: deps.engineUrl }
  if (sub === 'changes' && rest.length === 0) {
    const result = engineChanges(git, opts)
    if (result.kind === 'latest') console.log('latest')
    else if (result.kind === 'available') {
      console.log('available')
      for (const change of result.changes) console.log(`- ${change}`)
    } else {
      console.log('not fetched: the new version could not be downloaded; nothing changed')
      console.error(result.output)
      return EXIT.problems
    }
    return 0
  }
  if (sub === 'merge' && rest.length === 0) {
    const result = mergeEngine(git, opts)
    switch (result.kind) {
      case 'latest':
      case 'merged':
        console.log(result.kind)
        return 0
      case 'clashes':
        console.log(`clashes: ${result.files.join(', ')}`)
        return 0
      case 'not-fetched':
        console.log('not fetched: nothing has been fetched yet; run changes first')
        return EXIT.problems
      case 'not-merged':
        console.log('not merged: the new version could not be merged; nothing changed')
        console.error(result.output)
        return EXIT.problems
    }
  }
  const [side, file] = rest
  if (sub === 'take' && (side === 'ours' || side === 'theirs') && file && rest.length === 2) {
    const result = takeSide(git, side, file)
    if (result.kind !== 'taken') {
      console.error(
        result.kind === 'no-merge'
          ? 'update: no update is in progress'
          : `update: ${file} is not a clashing file`,
      )
      return EXIT.usage
    }
    const left = result.left.length ? `clashes left: ${result.left.join(', ')}` : 'no clashes left'
    console.log(`taken: ${file}; ${left}`)
    return 0
  }
  if (sub === 'finish' && rest.length === 0) {
    const result = finishUpdate(root, git, { run: deps.run })
    switch (result.kind) {
      case 'updated':
        console.log('updated')
        return 0
      case 'no-merge':
        console.error('update: no update is in progress')
        return EXIT.usage
      case 'clashes':
        console.log(`clashes left: ${result.files.join(', ')}`)
        return EXIT.problems
      case 'not-committed':
        console.log('not committed: the update could not be saved, so it was cancelled')
        console.error(result.output)
        return EXIT.problems
      case 'undone':
        console.log('undone: the install or the record check failed after the update')
        console.error(result.output)
        return EXIT.problems
      case 'not-undone':
        console.log(
          'not undone: the record check failed after the update, and the folder could not be put back',
        )
        console.error(result.output)
        return EXIT.problems
    }
  }
  if (sub === 'cancel' && rest.length === 0) {
    const result = cancelUpdate(git)
    if (result.kind === 'cancelled') {
      console.log('cancelled: nothing changed')
      return 0
    }
    console.log('not cancelled: the update could not be undone')
    console.error(result.output)
    return EXIT.problems
  }
  console.error(USAGE)
  return EXIT.usage
}

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
    if (force || existsSync(join(root, 'profile/coach.md'))) {
      await printCheck(root, { now, source, force, path: deps.path })
    }
    return 0
  }
  const git = gitIn(root, deps.path)
  if (sub && HISTORY_STEPS.includes(sub)) {
    if (git) return historyStep(git, root, args, deps)
    console.error('update: this folder keeps no history; update it with zip')
    return EXIT.usage
  }
  if (sub !== 'zip' || rest.length > 0) {
    console.error(USAGE)
    return EXIT.usage
  }
  if (git) {
    console.error('update: this folder keeps history; update it with changes, merge and finish')
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
