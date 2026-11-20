// Updating a folder that keeps history: the engine is merged in with git. The update is split into
// steps the coach drives across turns, because a file both sides changed needs the user's choice.
// Nothing is stored between the steps: git's own merge state says where an update stands, and the
// merge commit's first parent is the folder as it was before.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasClash, narrow, type SettledLine, settle } from './clash.ts'
import { ENGINE, ENGINE_URL, type Git, gitHubRepo, output } from './history.ts'
import { fallbackCommitter } from './save.ts'
import { checkBefore, keepOrUndo, type Run, runIn } from './verified-update.ts'

export type GitUpdateOptions = { url?: string | undefined; run?: Run | undefined }

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
// Git's own test, which follows .gitattributes: numstat counts no lines for a binary pair.
const binary = (git: Git, file: string) =>
  git(['diff', '--numstat', `:2:${file}`, `:3:${file}`]).stdout.startsWith('-\t')
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
  | { kind: 'merged'; settled?: Settled[] }
  | { kind: 'clashes'; files: string[]; settled?: Settled[] }
  // The records already fail the check, so nothing was merged.
  | { kind: 'not-started'; output: string }
  // Nothing was fetched yet: engineChanges comes first.
  | { kind: 'not-fetched' }
  | { kind: 'not-merged'; output: string }

// A line inside a clash that only one side changed, taken without asking.
export type Settled = SettledLine & { file: string }

const mergeState = (git: Git, settled: Settled[] = []): MergeResult => {
  const files = unmerged(git)
  const told = settled.length ? { settled } : {}
  return files.length ? { kind: 'clashes', files, ...told } : { kind: 'merged', ...told }
}

type Entry = { stage: string; mode: string; id: string }

// Unmerged paths with what each git stage holds (1 base, 2 ours, 3 theirs).
const stages = (git: Git): Map<string, Entry[]> => {
  const held = new Map<string, Entry[]>()
  for (const line of lines(git(['ls-files', '-u', '-z']).stdout.replaceAll('\0', '\n'))) {
    const match = line.match(/^(\d+) ([0-9a-f]+) (\d)\t(.+)$/)
    if (!match?.[1] || !match[2] || !match[3] || !match[4]) continue
    const entry = { mode: match[1], id: match[2], stage: match[3] }
    held.set(match[4], [...(held.get(match[4]) ?? []), entry])
  }
  return held
}
const holds = (entries: Entry[] | undefined, stage: string) =>
  entries?.some((e) => e.stage === stage) ?? false

const blob = (git: Git, rev: string, file: string) =>
  git(['rev-parse', '-q', '--verify', `${rev}:${file}`]).stdout.trim()

// Git parks a file that cannot sit at its own path (the other side holds a directory there, or
// each side made it a link) at "x~HEAD" or "x~<branch>", which neither commit holds. Such a path
// is part of the clash over "x", not a file of its own.
const suffixed = (git: Git, file: string) =>
  !blob(git, 'HEAD', file) && !blob(git, 'MERGE_HEAD', file)
const realPath = (git: Git, file: string) =>
  suffixed(git, file) && file.includes('~') ? file.slice(0, file.lastIndexOf('~')) : file

// Takes a whole side over one path. The index stages say what each side holds, because the
// commits cannot for a parked path; the other side's parked copy goes with it.
const resolve = (git: Git, side: 'ours' | 'theirs', file: string) => {
  const held = stages(git)
  const real = realPath(git, file)
  const group = [...held.keys()].filter((path) => realPath(git, path) === real)
  const wanted = side === 'ours' ? '2' : '3'
  const mine = group.flatMap((path) => held.get(path) ?? []).find((e) => e.stage === wanted)
  for (const path of group) git(['rm', '-q', '-f', '--', path])
  if (!mine) return
  // The chosen side's file replaces whatever else stands there, such as the other side's directory.
  git(['rm', '-r', '-q', '-f', '--ignore-unmatch', '--', real])
  git(['update-index', '--add', '--cacheinfo', `${mine.mode},${mine.id},${real}`])
  git(['checkout-index', '-f', '--', real])
}

export type ClashKind =
  // Only one side holds the file: the other removed it.
  | 'one-sided'
  | 'binary'
  // Both sides changed a text file and clash markers are still in it.
  | 'text-open'
  // Both sides changed a text file and no marker is left, so it was settled by hand.
  | 'text-settled'
  // Not a plain file (a link, a file against a directory, a parked path): taken whole.
  | 'other'

const REGULAR = new Set(['100644', '100755'])

// The one judgement of what a clashing file is; take, finish and the start-version view each
// act on the kind. The binary test needs both sides, so it runs only when both hold the file.
export const clashKind = (git: Git, dir: string, file: string, entries: Entry[]): ClashKind => {
  if (entries.some((e) => !REGULAR.has(e.mode)) || suffixed(git, file)) return 'other'
  if (!holds(entries, '2') || !holds(entries, '3')) return 'one-sided'
  if (binary(git, file)) return 'binary'
  const path = join(dir, file)
  return existsSync(path) && hasClash(readFileSync(path, 'utf8')) ? 'text-open' : 'text-settled'
}

// Every unmerged path with its kind, as the steps act on them.
export const clashKinds = (git: Git, dir: string): Map<string, ClashKind> =>
  new Map(
    [...stages(git)].map(([file, entries]) => [file, clashKind(git, dir, file, entries)] as const),
  )

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
const startOf = (git: Git, file: string, stagesHeld: Entry[], first: boolean): string => {
  if (holds(stagesHeld, '1')) return `:1:${file}`
  const root = rootCommit(git)
  return first && root && blob(git, root, file) ? `${root}:${file}` : ''
}

const LABELS = ['-L', 'yours', '-L', 'before', '-L', 'new version']

// The file as merge-file shows it against the start version, narrowed; undefined when a side
// could not be read or merge-file failed, so git's own clash markers stay.
const showOne = (git: Git, file: string, start: string, scratch: string) => {
  const saved = (rev: string, name: string): string | undefined => {
    const shown = git(['show', rev])
    if (shown.status !== 0) return undefined
    const path = join(scratch, name)
    writeFileSync(path, shown.stdout)
    return path
  }
  const sides = [saved(`:2:${file}`, 'ours'), saved(start, 'start'), saved(`:3:${file}`, 'theirs')]
  if (!sides.every((side) => side !== undefined)) return
  const shown = git(['merge-file', '-p', '--diff3', ...LABELS, ...sides])
  // merge-file exits with the number of clashes it left; only a signal or 255 is a failure.
  if (shown.status === null || shown.status >= 128) return
  return narrow(shown.stdout, { lineByLine: /\.ya?ml$/.test(file) })
}

// Each clash is rewritten with the file as both sides started from it, under labels the coach can
// read out. Two sides alone cannot show which values the user changed, so the old default would
// be credited to them. A first update has no shared start, so the copy's first commit stands in.
const showStart = (git: Git, first: boolean): Settled[] => {
  const settled: Settled[] = []
  const top = git(['rev-parse', '--show-toplevel']).stdout.trim()
  const held = stages(git)
  const kinds = clashKinds(git, top)
  const scratch = mkdtempSync(join(tmpdir(), 'coach-clash-'))
  try {
    for (const file of unmerged(git)) {
      // Markers go only into a plain text file both sides hold: a link would pass them on to its
      // target, and a binary file cannot take them.
      const kind = kinds.get(file)
      const start =
        kind === 'text-open' || kind === 'text-settled'
          ? startOf(git, file, held.get(file) ?? [], first)
          : ''
      const narrowed = start ? showOne(git, file, start, scratch) : undefined
      if (!narrowed) continue
      writeFileSync(join(top, file), narrowed.text)
      for (const line of narrowed.settled) settled.push({ file, ...line })
      // Each line differs on one side only, so nothing is left to ask about.
      if (!hasClash(narrowed.text)) git(['add', '--', file])
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return settled
}

export const mergeEngine = (root: string, git: Git, opts: GitUpdateOptions = {}): MergeResult => {
  if (inMerge(git)) return mergeState(git)
  const remote = engineRemote(git, opts.url ?? ENGINE_URL)
  const ref = `${remote}/main`
  if (!remote || !ok(git, ['rev-parse', '-q', '--verify', ref])) return { kind: 'not-fetched' }
  if (upToDate(git, ref)) return { kind: 'latest' }
  // Checked here and not in finish: a user whose records were already broken would otherwise settle
  // clashes and then see the update undone as the new version's fault.
  const refused = checkBefore(root, opts.run ?? runIn(root))
  if (refused !== undefined) return { kind: 'not-started', output: refused }
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
  return mergeState(git, showStart(git, first))
}

export type TakeResult =
  | { kind: 'taken'; left: string[] }
  | { kind: 'no-merge' }
  | { kind: 'not-clashing' }

export const takeSide = (git: Git, side: 'ours' | 'theirs', file: string): TakeResult => {
  if (!inMerge(git)) return { kind: 'no-merge' }
  if (!unmerged(git).includes(file)) return { kind: 'not-clashing' }
  const top = git(['rev-parse', '--show-toplevel']).stdout.trim()
  const path = join(top, file)
  // Only the clash blocks are the user's choice; the rest of the file already holds both sides'
  // changes. Any other kind has no blocks and is taken whole.
  if (clashKinds(git, top).get(file) === 'text-open') {
    writeFileSync(path, settle(readFileSync(path, 'utf8'), side))
    git(['add', '--', file])
  } else resolve(git, side, file)
  return { kind: 'taken', left: unmerged(git) }
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
  const kinds = clashKinds(git, root)
  // Only a text file settled by hand can be finished as it stands; any other kind carries no
  // markers to read a choice from, so finishing would choose for the user. Only take settles it.
  const left = files.filter((file) => kinds.get(file) !== 'text-settled')
  if (left.length) return { kind: 'clashes', files: left }
  // Each clash still listed now holds both sides merged into one file, or is gone.
  for (const file of files) git(['add', '-A', '--', file])
  const commit = git([...fallbackCommitter(git), 'commit', '-q', '-m', 'Updated the coach'])
  if (commit.status !== 0) {
    git(['merge', '--abort'])
    return { kind: 'not-committed', output: output(commit) }
  }
  return keepOrUndo(root, opts.run ?? runIn(root), {
    lockChanged: !ok(git, ['diff', '--quiet', 'HEAD^1', 'HEAD', '--', 'package-lock.json']),
    undo: () => {
      const reset = git(['reset', '-q', '--keep', 'HEAD^1'])
      return reset.status === 0 ? undefined : output(reset)
    },
  })
}

export type CancelResult = { kind: 'cancelled' } | { kind: 'not-cancelled'; output: string }

export const cancelUpdate = (git: Git): CancelResult => {
  if (!inMerge(git)) return { kind: 'cancelled' }
  const abort = git(['merge', '--abort'])
  return inMerge(git) ? { kind: 'not-cancelled', output: output(abort) } : { kind: 'cancelled' }
}
