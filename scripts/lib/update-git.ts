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
  | { kind: 'clashes'; files: string[]; settled?: Settled[]; renames?: Rename[] }
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
  return files.length
    ? { kind: 'clashes', files, ...told, ...pending(git) }
    : { kind: 'merged', ...told }
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

const only = (entries: Entry[] | undefined, stage: string) =>
  entries?.length === 1 && holds(entries, stage)

// Git parks a file that cannot sit at its own path (the other side holds a directory there, or
// each side made it a link) at "x~HEAD" or "x~<branch>", which neither commit holds. Such a path
// is part of the clash over "x", not a file of its own. A path the base holds and neither side
// does is no parked copy: it is where a rename started, so only its base stage is left.
const parked = (git: Git, file: string, entries: Entry[] | undefined) =>
  !only(entries, '1') && !blob(git, 'HEAD', file) && !blob(git, 'MERGE_HEAD', file)
const realPath = (git: Git, file: string, entries: Entry[] | undefined) =>
  parked(git, file, entries) && file.includes('~') ? file.slice(0, file.lastIndexOf('~')) : file

// A file both sides renamed, each to a name of its own: git leaves the old path (base stage
// only) and one new path per side (that side's stage only). The three are one clash, over the name.
export type Rename = {
  base: string
  ours: string
  theirs: string
  // The two sides also changed the same lines, or git could not merge the content, so the file
  // differs between the two names.
  contentClash: boolean
}

// Old path to new path for every rename between the merge base and one side, as git sees it.
const movedBy = (git: Git, base: string, rev: string): Map<string, string> => {
  const parts = git(['diff', '-M', '--name-status', '-z', base, rev]).stdout.split('\0')
  const moved = new Map<string, string>()
  for (let i = 0; i < parts.length; ) {
    const status = parts[i] ?? ''
    if (status.startsWith('R') || status.startsWith('C')) {
      const [from, to] = [parts[i + 1], parts[i + 2]]
      if (status.startsWith('R') && from && to) moved.set(from, to)
      i += 3
    } else i += 2
  }
  return moved
}

// Git lengthens its markers to 8 characters in a file held under two names, which hasClash, made
// for the 7 of an ordinary text clash, does not see. A bare line of "=" is no marker (a Markdown
// heading underline), so an opening and a closing marker are both required.
const MARKER_LINE = /^<{7,}( |$)[\s\S]*^>{7,}( |$)/m

export const renamesOf = (git: Git): Rename[] => {
  if (!inMerge(git)) return []
  const base = git(['merge-base', 'HEAD', 'MERGE_HEAD']).stdout.trim()
  if (!base) return []
  const held = stages(git)
  // A rename on both sides always leaves its old path held at the base alone.
  if (![...held.values()].some((entries) => only(entries, '1'))) return []
  const theirs = movedBy(git, base, 'MERGE_HEAD')
  return [...movedBy(git, base, 'HEAD')].flatMap(([from, ours]) => {
    const other = theirs.get(from)
    if (!other || other === ours) return []
    if (!only(held.get(from), '1') || !only(held.get(ours), '2') || !only(held.get(other), '3'))
      return []
    // Judged from what git staged, never from the folder, so a hand edit or a deleted file
    // cannot make a take write a blob that holds markers.
    const ids = [held.get(ours)?.[0]?.id, held.get(other)?.[0]?.id]
    const marked = ids.some((id) => id && MARKER_LINE.test(git(['cat-file', 'blob', id]).stdout))
    return [{ base: from, ours, theirs: other, contentClash: marked || ids[0] !== ids[1] }]
  })
}

const inRename = (rename: Rename, file: string) =>
  file === rename.base || file === rename.ours || file === rename.theirs

// Takes a whole side over one path. The index stages say what each side holds, because the
// commits cannot for a parked path; the other side's parked copy goes with it.
// Returns the files in the chosen file's way when it would replace a directory holding any that
// are not saved (untracked, ignored such as an exported PDF, or edited since the update began);
// then nothing is changed.
const resolve = (git: Git, side: 'ours' | 'theirs', file: string): string[] => {
  const held = stages(git)
  const real = realPath(git, file, held.get(file))
  const group = [...held.keys()].filter((path) => realPath(git, path, held.get(path)) === real)
  const wanted = side === 'ours' ? '2' : '3'
  const mine = group.flatMap((path) => held.get(path) ?? []).find((e) => e.stage === wanted)
  // Without --exclude-standard, ignored files are listed too.
  // Only what sits under the path counts: a hand edit to the clashing file itself is what a take
  // discards.
  const notSaved = (args: string[]) =>
    lines(git(args).stdout.replaceAll('\0', '\n')).filter((path) => path.startsWith(`${real}/`))
  const inTheWay = mine
    ? [
        ...new Set([
          ...notSaved(['ls-files', '--others', '-z', '--', real]),
          ...notSaved(['diff', '--name-only', '--diff-filter=MT', '-z', '--', real]),
        ]),
      ].sort()
    : []
  if (inTheWay.length) return inTheWay
  for (const path of group) git(['rm', '-q', '-f', '--', path])
  if (!mine) return []
  // The chosen side's file replaces whatever else stands there, such as the other side's directory.
  git(['rm', '-r', '-q', '-f', '--ignore-unmatch', '--', real])
  git(['update-index', '--add', '--cacheinfo', `${mine.mode},${mine.id},${real}`])
  git(['checkout-index', '-f', '--', real])
  return []
}

export type ClashKind =
  // Only one side holds the file: the other removed it.
  | 'one-sided'
  | 'binary'
  // Both sides changed a text file and clash markers are still in it.
  | 'text-open'
  // Both sides changed a text file and no marker is left, so it was settled by hand.
  | 'text-settled'
  // One of the three paths of a file both sides renamed, each to a different name: one choice.
  | 'renamed'
  // Not a plain file (a link, a file against a directory, a parked path), or a path only the base
  // holds that git did not pair with a rename: taken whole.
  | 'other'

const REGULAR = new Set(['100644', '100755'])

// The one judgement of what a clashing file is; take, finish and the start-version view each
// act on the kind. The binary test needs both sides, so it runs only when both hold the file.
const judge =
  (git: Git, dir: string, renames: Rename[]) =>
  (file: string, entries: Entry[]): ClashKind => {
    if (renames.some((rename) => inRename(rename, file))) return 'renamed'
    if (entries.some((e) => !REGULAR.has(e.mode)) || parked(git, file, entries)) return 'other'
    if (only(entries, '1')) return 'other'
    if (!holds(entries, '2') || !holds(entries, '3')) return 'one-sided'
    if (binary(git, file)) return 'binary'
    const path = join(dir, file)
    return existsSync(path) && hasClash(readFileSync(path, 'utf8')) ? 'text-open' : 'text-settled'
  }

export const clashKind = (git: Git, dir: string, file: string, entries: Entry[]): ClashKind =>
  judge(git, dir, renamesOf(git))(file, entries)

// Every unmerged path with its kind, as the steps act on them.
export const clashKinds = (git: Git, dir: string): Map<string, ClashKind> => {
  const kindOf = judge(git, dir, renamesOf(git))
  return new Map([...stages(git)].map(([file, entries]) => [file, kindOf(file, entries)] as const))
}

const topOf = (git: Git) => git(['rev-parse', '--show-toplevel']).stdout.trim()

// The renames still unsettled, in the shape a result carries them: left out when there are none.
const pending = (git: Git): { renames?: Rename[] } => {
  const renames = renamesOf(git)
  return renames.length ? { renames } : {}
}

// Takes a whole side of a rename: its name stays, the other two paths go. When the content
// clashes too, the side's own version of the file is kept, since git's merged copy holds markers.
const resolveRename = (git: Git, side: 'ours' | 'theirs', rename: Rename) => {
  const chosen = rename[side]
  const wanted = side === 'ours' ? '2' : '3'
  const entry = stages(git)
    .get(chosen)
    ?.find((e) => e.stage === wanted)
  if (!entry) return
  const id = rename.contentClash
    ? blob(git, side === 'ours' ? 'HEAD' : 'MERGE_HEAD', chosen)
    : entry.id
  for (const path of [rename.base, rename.ours, rename.theirs]) git(['rm', '-q', '-f', '--', path])
  git(['update-index', '--add', '--cacheinfo', `${entry.mode},${id},${chosen}`])
  git(['checkout-index', '-f', '--', chosen])
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
  | { kind: 'taken'; left: string[]; renames?: Rename[] }
  | { kind: 'no-merge' }
  | { kind: 'not-clashing' }
  // The chosen file would replace a folder that holds files of the user's that are not saved.
  | { kind: 'in-the-way'; files: string[] }

export const takeSide = (git: Git, side: 'ours' | 'theirs', file: string): TakeResult => {
  if (!inMerge(git)) return { kind: 'no-merge' }
  if (!unmerged(git).includes(file)) return { kind: 'not-clashing' }
  const top = topOf(git)
  const path = join(top, file)
  const rename = renamesOf(git).find((r) => inRename(r, file))
  // Only the clash blocks are the user's choice; the rest of the file already holds both sides'
  // changes. Any other kind has no blocks and is taken whole.
  if (rename) {
    resolveRename(git, side, rename)
  } else if (clashKinds(git, top).get(file) === 'text-open') {
    writeFileSync(path, settle(readFileSync(path, 'utf8'), side))
    git(['add', '--', file])
  } else {
    const inTheWay = resolve(git, side, file)
    if (inTheWay.length) return { kind: 'in-the-way', files: inTheWay }
  }
  return { kind: 'taken', left: unmerged(git), ...pending(git) }
}

export type FinishResult =
  | { kind: 'updated' }
  | { kind: 'no-merge' }
  | { kind: 'clashes'; files: string[]; renames?: Rename[] }
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
  if (left.length) return { kind: 'clashes', files: left, ...pending(git) }
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
