// Saves the user's data into this folder's history and backs it up to the online copy.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Git, gitIn, output } from './history.ts'
import { type OnlineCopyLookup, onlineCopy } from './online-copy.ts'

// User data: the folders a save commits. Not the same set as what a Coach update leaves alone
// (`isEngineFile` in update.ts): that also protects Local work files such as discovery/, which are
// neither saved nor replaced, while it does replace the engine files inside pipeline/ and
// experience-bank/, which a save commits along with the rest of those folders.
export const USER_DATA_FOLDERS = ['profile', 'cv', 'pipeline', 'experience-bank']

export type Online = 'pushed' | 'no-copy' | 'public' | 'unchecked' | 'failed'

export type SaveResult =
  | { kind: 'no-history' }
  | { kind: 'nothing' }
  // The commit failed, usually on a pre-commit check; the data stays written but unsaved.
  | { kind: 'refused'; output: string }
  | { kind: 'saved'; online: Online; output?: string }

export type SaveOptions = {
  message: string
  // Every change in the folder, not only the data folders, for a caller about to merge: git
  // refuses to merge over unsaved changes to files the merge touches.
  everything?: boolean
  lookup?: OnlineCopyLookup
  path?: string
}

// Without an email set, git may refuse to commit when it cannot work one out; until one is
// set, every save commits under a stand-in name and email, replacing any name already set.
export const fallbackCommitter = (git: Git): string[] =>
  git(['config', 'user.email']).stdout.trim()
    ? []
    : ['-c', 'user.name=Job coach', '-c', 'user.email=job-coach@localhost']

const pathsToSave = (root: string, git: Git): string[] =>
  USER_DATA_FOLDERS.filter(
    (dir) => existsSync(join(root, dir)) || git(['ls-files', '--', dir]).stdout.trim() !== '',
  )

// The engine is never pushed to. Another copy on GitHub is pushed to only when GitHub answers, at
// every save, that it is not public, so a copy made public after onboarding stops receiving data;
// without that answer (offline, rate limited, an address it cannot read) the push waits for the
// next save, which sends them even when it has nothing new to commit. A copy elsewhere cannot be
// checked, and relies on onboarding's question about whether it is private.
const pushOnline = async (
  root: string,
  git: Git,
  lookup: OnlineCopyLookup,
): Promise<SaveResult> => {
  const copy = await lookup(root)
  if (copy === 'none') return { kind: 'saved', online: 'no-copy' }
  if (copy === 'engine' || copy === 'public') return { kind: 'saved', online: 'public' }
  if (copy === 'unknown') return { kind: 'saved', online: 'unchecked' }
  const push = git(['push', '-q', 'origin', 'HEAD'], { GIT_TERMINAL_PROMPT: '0' })
  return push.status === 0
    ? { kind: 'saved', online: 'pushed' }
    : { kind: 'saved', online: 'failed', output: output(push) }
}

// Commits that no origin branch is known to hold, judged from the refs already fetched so that
// a clean save makes no network call. Unfetched pushes made elsewhere look unsent and are pushed
// again, which git accepts as already up to date.
const unsent = (git: Git): boolean =>
  git(['remote', 'get-url', 'origin']).status === 0 &&
  Number(git(['rev-list', '--count', 'HEAD', '--not', '--remotes=origin']).stdout.trim()) > 0

// With nothing to commit, commits left by an earlier held or failed push, or by a merge, still go
// online under the same rules as a fresh save.
const nothingToCommit = (
  root: string,
  git: Git,
  lookup: OnlineCopyLookup,
): Promise<SaveResult> | SaveResult =>
  unsent(git) ? pushOnline(root, git, lookup) : { kind: 'nothing' }

export const save = async (root: string, opts: SaveOptions): Promise<SaveResult> => {
  const git = gitIn(root, opts.path)
  if (!git) return { kind: 'no-history' }
  const lookup = opts.lookup ?? onlineCopy
  const paths = opts.everything ? ['.'] : pathsToSave(root, git)
  if (paths.length === 0) return nothingToCommit(root, git, lookup)
  git(['add', '-A', '--', ...paths])
  // Commit the staged paths by name, not the folders: git fails a commit whose folder holds nothing
  // it tracks (empty, or only ignored files). --no-renames keeps a moved file's old path in the
  // list, so the move is committed whole.
  const staged = git(['diff', '--cached', '--no-renames', '--name-only', '-z', '--', ...paths])
    .stdout.split('\0')
    .filter(Boolean)
  if (staged.length === 0) return nothingToCommit(root, git, lookup)
  const commit = git([
    ...fallbackCommitter(git),
    'commit',
    '-q',
    '-m',
    opts.message,
    '--',
    ...staged,
  ])
  if (commit.status !== 0) return { kind: 'refused', output: output(commit) }
  return pushOnline(root, git, lookup)
}
