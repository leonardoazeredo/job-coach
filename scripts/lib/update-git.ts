// Updating a folder that keeps history: the engine is merged in with git. The update is split into
// steps the coach drives across turns, because a file both sides changed needs the user's choice.
// Nothing is stored between the steps: git's own merge state says where an update stands, and the
// merge commit's first parent is the folder as it was before.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasClash, narrow, settle } from './clash.ts'
import { ENGINE, ENGINE_URL, type Git, gitHubRepo, output } from './history.ts'
import { fallbackCommitter } from './save.ts'
import { type Run, recordCheck, runIn } from './update.ts'

export type GitUpdateOptions = { url?: string | undefined }

// Each remote's address as configured. `git remote -v` shows it after any insteadOf rewrite,
// which would hide that a rewritten remote is the engine and add a second one.
const fetchRemotes = (git: Git): [string, string][] =>
  lines(git(['config', '--get-regexp', '^remote\\..*\\.url$']).stdout).flatMap(
    (line): [string, string][] => {
      const match = line.match(/^remote\.(.+)\.url (.+)$/)
      return match?.[1] && match[2] ? [[match[1], match[2]]] : []
    },
  )

const engineRemote = (git: Git, url: string): string | undefined =>
  fetchRemotes(git).find(([, u]) => u === url || gitHubRepo(u) === ENGINE)?.[0]

const connect = (git: Git, url: string): string => {
  const found = engineRemote(git, url)
  if (found) return found
  // onboarding names the engine upstream; a folder that already uses that name for something
  // else gets a second name rather than having its own remote repointed.
  const taken = new Set(fetchRemotes(git).map(([name]) => name))
  const name = taken.has('upstream') ? 'coach-engine' : 'upstream'
  git(['remote', 'add', name, url])
  return name
}

const ok = (git: Git, args: string[]) => git(args).status === 0
const lines = (text: string) => text.split('\n').filter(Boolean)
const inMerge = (git: Git) => ok(git, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
// -z keeps a path with unusual characters unquoted, so it matches the stages listing.
const unmerged = (git: Git) =>
  lines(git(['diff', '--name-only', '--diff-filter=U', '-z']).stdout.replaceAll('\0', '\n'))
const upToDate = (git: Git, ref: string) => ok(git, ['merge-base', '--is-ancestor', ref, 'HEAD'])
// A copy made with "Use this template" shares no commit with the engine until its first update.
const sharesHistory = (git: Git, ref: string) => ok(git, ['merge-base', 'HEAD', ref])
const rootCommit = (git: Git) => lines(git(['rev-list', '--max-parents=0', 'HEAD']).stdout)[0]

export type ChangesResult =
  | { kind: 'latest' }
  | { kind: 'available'; changes: string[] }
  | { kind: 'not-fetched'; output: string }

export const engineChanges = (git: Git, opts: GitUpdateOptions = {}): ChangesResult => {
  const remote = connect(git, opts.url ?? ENGINE_URL)
  const fetch = git(['fetch', '-q', remote, 'main'])
  if (fetch.status !== 0) return { kind: 'not-fetched', output: output(fetch) }
  const ref = `${remote}/main`
  if (upToDate(git, ref)) return { kind: 'latest' }
  // With no shared commit, everything the engine ever did would count as new; only what it did
  // since this copy was made is.
  const log = sharesHistory(git, ref)
    ? git(['log', '--no-merges', '--format=%s', `HEAD..${ref}`])
    : git([
        'log',
        '--no-merges',
        '--format=%s',
        `--since=${git(['log', '-1', '--format=%aI', rootCommit(git) ?? 'HEAD']).stdout.trim()}`,
        ref,
      ])
  const changes = lines(log.stdout)
  // A copy made from the engine's newest version still shares no commit with it, so only an
  // empty list can tell that nothing new has landed since.
  return changes.length ? { kind: 'available', changes } : { kind: 'latest' }
}

export type MergeResult =
  | { kind: 'latest' }
  | { kind: 'merged' }
  | { kind: 'clashes'; files: string[] }
  // Nothing was fetched yet: engineChanges comes first.
  | { kind: 'not-fetched' }
  | { kind: 'not-merged'; output: string }

const mergeState = (git: Git): MergeResult => {
  const files = unmerged(git)
  return files.length ? { kind: 'clashes', files } : { kind: 'merged' }
}

const blob = (git: Git, rev: string, file: string) =>
  git(['rev-parse', '-q', '--verify', `${rev}:${file}`]).stdout.trim()

const resolve = (git: Git, side: 'ours' | 'theirs', file: string) => {
  // A side that deleted the file is taken by deleting it.
  if (!blob(git, side === 'ours' ? 'HEAD' : 'MERGE_HEAD', file)) git(['rm', '-q', '--', file])
  else {
    git(['checkout', `--${side}`, '--', file])
    git(['add', '--', file])
  }
}

// With no shared commit, git sees every file the two sides hold differently as a clash, even
// when only one side changed it. The copy's first commit shows which: a file the user never
// edited takes the new version, and one the engine never changed keeps the user's.
const settleOneSided = (git: Git) => {
  const root = rootCommit(git) ?? 'HEAD'
  for (const file of unmerged(git)) {
    const original = blob(git, root, file)
    if (!original) continue
    if (original === blob(git, 'HEAD', file)) resolve(git, 'theirs', file)
    else if (original === blob(git, 'MERGE_HEAD', file)) resolve(git, 'ours', file)
  }
}

// Where a clashing file started: the shared version when git found one, else on a first update
// the copy's first commit, else nothing to show.
const startOf = (git: Git, file: string, stagesHeld: Set<string>, first: boolean): string => {
  if (stagesHeld.has('1')) return `:1:${file}`
  const root = rootCommit(git)
  return first && root && blob(git, root, file) ? `${root}:${file}` : ''
}

const LABELS = ['-L', 'yours', '-L', 'before', '-L', 'new version']

// Each clash is rewritten with the file as both sides started from it, under labels the coach can
// read out. Two sides alone cannot show which values the user changed, so the old default would
// be credited to them. A first update has no shared start, so the copy's first commit stands in.
const showStart = (git: Git, first: boolean) => {
  const top = git(['rev-parse', '--show-toplevel']).stdout.trim()
  const held = stages(git)
  const scratch = mkdtempSync(join(tmpdir(), 'coach-clash-'))
  const saved = (rev: string, name: string) => {
    const path = join(scratch, name)
    writeFileSync(path, git(['show', rev]).stdout)
    return path
  }
  try {
    for (const file of unmerged(git)) {
      const at = held.get(file) ?? new Set()
      const start = at.has('2') && at.has('3') ? startOf(git, file, at, first) : ''
      if (!start) continue
      const sides = [
        saved(`:2:${file}`, 'ours'),
        saved(start, 'start'),
        saved(`:3:${file}`, 'theirs'),
      ]
      const shown = git(['merge-file', '-p', '--diff3', ...LABELS, ...sides])
      // merge-file exits with the number of clashes it left; only a signal or 255 is a failure.
      if (shown.status === null || shown.status >= 128) continue
      const narrowed = narrow(shown.stdout)
      writeFileSync(join(top, file), narrowed)
      // Every line was changed on one side only, so nothing is left to ask about.
      if (!hasClash(narrowed)) git(['add', '--', file])
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

export const mergeEngine = (git: Git, opts: GitUpdateOptions = {}): MergeResult => {
  if (inMerge(git)) return mergeState(git)
  const remote = engineRemote(git, opts.url ?? ENGINE_URL)
  const ref = `${remote}/main`
  if (!remote || !ok(git, ['rev-parse', '-q', '--verify', ref])) return { kind: 'not-fetched' }
  if (upToDate(git, ref)) return { kind: 'latest' }
  const first = !sharesHistory(git, ref)
  const merge = git([
    'merge',
    '--no-commit',
    '--no-ff',
    ...(first ? ['--allow-unrelated-histories'] : []),
    ref,
  ])
  if (!inMerge(git)) return { kind: 'not-merged', output: output(merge) }
  if (first) settleOneSided(git)
  showStart(git, first)
  return mergeState(git)
}

export type TakeResult =
  | { kind: 'taken'; left: string[] }
  | { kind: 'no-merge' }
  | { kind: 'not-clashing' }

export const takeSide = (git: Git, side: 'ours' | 'theirs', file: string): TakeResult => {
  if (!inMerge(git)) return { kind: 'no-merge' }
  if (!unmerged(git).includes(file)) return { kind: 'not-clashing' }
  const path = join(git(['rev-parse', '--show-toplevel']).stdout.trim(), file)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  // Only the clash blocks are the user's choice; the rest of the file already holds both sides'
  // changes. A file one side removed has no blocks and is taken whole.
  if (hasClash(text)) {
    writeFileSync(path, settle(text, side))
    git(['add', '--', file])
  } else resolve(git, side, file)
  return { kind: 'taken', left: unmerged(git) }
}

// Unmerged paths with the git stage numbers each still holds (1 base, 2 ours, 3 theirs).
const stages = (git: Git): Map<string, Set<string>> => {
  const held = new Map<string, Set<string>>()
  for (const line of lines(git(['ls-files', '-u', '-z']).stdout.replaceAll('\0', '\n'))) {
    const match = line.match(/^\d+ [0-9a-f]+ (\d)\t(.+)$/)
    if (!match?.[1] || !match[2]) continue
    held.set(match[2], (held.get(match[2]) ?? new Set()).add(match[1]))
  }
  return held
}

export type FinishResult =
  | { kind: 'updated' }
  | { kind: 'no-merge' }
  | { kind: 'clashes'; files: string[] }
  // The commit itself failed, so the merge was abandoned and nothing changed.
  | { kind: 'not-committed'; output: string }
  // The install or the record check failed after the commit, so the folder went back to before.
  | { kind: 'undone'; output: string }
  // The check failed and putting the folder back failed too: the new version is still in place.
  | { kind: 'not-undone'; output: string }

export type FinishOptions = { run?: Run | undefined }

export const finishUpdate = (root: string, git: Git, opts: FinishOptions = {}): FinishResult => {
  if (!inMerge(git)) return { kind: 'no-merge' }
  const files = unmerged(git)
  const held = stages(git)
  // A file one side removed carries no markers, so finishing on what is left in the folder would
  // choose for the user. Only take settles it. A binary file both sides changed is not caught.
  const left = files.filter(
    (file) =>
      !(held.get(file)?.has('2') && held.get(file)?.has('3')) ||
      (existsSync(join(root, file)) && hasClash(readFileSync(join(root, file), 'utf8'))),
  )
  if (left.length) return { kind: 'clashes', files: left }
  // Each clash still listed now holds both sides merged into one file, or is gone.
  for (const file of files) git(['add', '-A', '--', file])
  const commit = git([...fallbackCommitter(git), 'commit', '-q', '-m', 'Updated the coach'])
  if (commit.status !== 0) {
    git(['merge', '--abort'])
    return { kind: 'not-committed', output: output(commit) }
  }
  const run = opts.run ?? runIn(root)
  const lockChanged = !ok(git, ['diff', '--quiet', 'HEAD^1', 'HEAD', '--', 'package-lock.json'])
  const install = lockChanged ? run('npm', ['ci']) : { ok: true, output: '' }
  const after = install.ok ? recordCheck(root, run) : install
  if (after.ok) return { kind: 'updated' }
  const reset = git(['reset', '-q', '--keep', 'HEAD^1'])
  if (lockChanged) run('npm', ['ci'])
  if (reset.status !== 0) return { kind: 'not-undone', output: `${after.output}\n${output(reset)}` }
  return { kind: 'undone', output: after.output }
}

export type CancelResult = { kind: 'cancelled' } | { kind: 'not-cancelled'; output: string }

export const cancelUpdate = (git: Git): CancelResult => {
  if (!inMerge(git)) return { kind: 'cancelled' }
  const abort = git(['merge', '--abort'])
  return inMerge(git) ? { kind: 'not-cancelled', output: output(abort) } : { kind: 'cancelled' }
}
