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
//   finish   commits, installs, runs the record check and prints updated, or clashes left while a
//            file holds a clash marker or one side removed it, or undone when the install or check failed and the folder went
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
  type ZipResult,
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

// One line on stdout for the coach to act on, and the reason, when there is one, on stderr.
const say = (code: number, line: string, reason?: string): number => {
  console.log(line)
  if (reason !== undefined) console.error(reason)
  return code
}
const refuse = (message: string): number => {
  console.error(`update: ${message}`)
  return EXIT.usage
}

type Step = (git: Git, root: string, args: string[], deps: UpdateDeps) => number

const changesStep: Step = (git, _root, _args, deps) => {
  const result = engineChanges(git, { url: deps.engineUrl })
  if (result.kind === 'not-fetched') {
    return say(
      EXIT.problems,
      'not fetched: the new version could not be downloaded; nothing changed',
      result.output,
    )
  }
  console.log(result.kind)
  if (result.kind === 'available') for (const change of result.changes) console.log(`- ${change}`)
  return 0
}

const mergeStep: Step = (git, _root, _args, deps) => {
  const result = mergeEngine(git, { url: deps.engineUrl })
  switch (result.kind) {
    case 'latest':
    case 'merged':
      return say(0, result.kind)
    case 'clashes':
      return say(0, `clashes: ${result.files.join(', ')}`)
    case 'not-fetched':
      return say(EXIT.problems, 'not fetched: nothing has been fetched yet; run changes first')
    case 'not-merged':
      return say(
        EXIT.problems,
        'not merged: the new version could not be merged; nothing changed',
        result.output,
      )
  }
}

const takeStep: Step = (git, _root, args) => {
  const [side, file] = args
  if ((side !== 'ours' && side !== 'theirs') || !file || args.length !== 2) {
    console.error(USAGE)
    return EXIT.usage
  }
  const result = takeSide(git, side, file)
  if (result.kind === 'no-merge') return refuse('no update is in progress')
  if (result.kind === 'not-clashing') return refuse(`${file} is not a clashing file`)
  const left = result.left.length ? `clashes left: ${result.left.join(', ')}` : 'no clashes left'
  return say(0, `taken: ${file}; ${left}`)
}

const finishStep: Step = (git, root, _args, deps) => {
  const result = finishUpdate(root, git, { run: deps.run })
  switch (result.kind) {
    case 'updated':
      return say(0, 'updated')
    case 'no-merge':
      return refuse('no update is in progress')
    case 'clashes':
      return say(EXIT.problems, `clashes left: ${result.files.join(', ')}`)
    case 'not-committed':
      return say(
        EXIT.problems,
        'not committed: the update could not be saved, so it was cancelled',
        result.output,
      )
    case 'undone':
      return say(
        EXIT.problems,
        'undone: the install or the record check failed after the update',
        result.output,
      )
    case 'not-undone':
      return say(
        EXIT.problems,
        'not undone: the record check failed after the update, and the folder could not be put back',
        result.output,
      )
  }
}

const cancelStep: Step = (git) => {
  const result = cancelUpdate(git)
  if (result.kind === 'cancelled') return say(0, 'cancelled: nothing changed')
  return say(EXIT.problems, 'not cancelled: the update could not be undone', result.output)
}

// take carries its own arguments; the others take none.
const HISTORY_STEPS: Record<string, { step: Step; takesArgs: boolean }> = {
  changes: { step: changesStep, takesArgs: false },
  merge: { step: mergeStep, takesArgs: false },
  take: { step: takeStep, takesArgs: true },
  finish: { step: finishStep, takesArgs: false },
  cancel: { step: cancelStep, takesArgs: false },
}

const printZip = (result: ZipResult): number => {
  switch (result.kind) {
    case 'latest':
      return say(0, 'latest')
    case 'updated': {
      // config/ is where a user tunes the coach, and the update overwrites those edits without
      // asking, so each one is named for the user to bring back from the backup.
      const settings = result.replaced.filter((rel) => rel.startsWith('config/'))
      return say(
        0,
        `updated: ${result.replaced.length} replaced, ${result.added.length} added; backup in ${result.backup}${settings.length ? `; settings replaced: ${settings.join(', ')}` : ''}`,
      )
    }
    case 'not-started':
      return say(
        EXIT.problems,
        'not started: the record check fails before the update',
        result.output,
      )
    case 'not-fetched':
      return say(
        EXIT.problems,
        'not fetched: the new version could not be downloaded; nothing changed',
        result.output,
      )
    case 'undone':
      return say(
        EXIT.problems,
        `undone: the install or the record check failed after the update; backup in ${result.backup}`,
        result.output,
      )
  }
}

export const updateCommand = async (
  args: string[],
  root: string,
  deps: UpdateDeps = {},
): Promise<number> => {
  const now = deps.now ?? new Date()
  const source = deps.source ?? gitHubEngine
  const [sub = '', ...rest] = args
  if (sub === 'check' && rest.every((a) => a === '--now')) {
    const force = rest.includes('--now')
    // Before onboarding, a new user has not met the coach yet, so a weekly offer stays silent.
    const due = force || existsSync(join(root, 'profile/coach.md'))
    if (due) await printCheck(root, { now, source, force, path: deps.path })
    return 0
  }
  const git = gitIn(root, deps.path)
  const history = Object.hasOwn(HISTORY_STEPS, sub) ? HISTORY_STEPS[sub] : undefined
  if (history && (history.takesArgs || rest.length === 0)) {
    return git
      ? history.step(git, root, rest, deps)
      : refuse('this folder keeps no history; update it with zip')
  }
  if (sub !== 'zip' || rest.length > 0) {
    console.error(USAGE)
    return EXIT.usage
  }
  if (git) return refuse('this folder keeps history; update it with changes, merge and finish')
  return printZip(await updateFromArchive(root, { now, source, run: deps.run }))
}

if (import.meta.main) process.exitCode = await updateCommand(process.argv.slice(2), repoRoot())
