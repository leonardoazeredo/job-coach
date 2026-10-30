// Saves the user's data into this folder's history and backs it up to the online copy.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ENGINE, type Git, gitHubRepo, gitIn, output } from './history.ts'

export const DATA_FOLDERS = ['profile', 'cv', 'pipeline', 'experience-bank']

export type Online = 'pushed' | 'no-copy' | 'public' | 'unchecked' | 'failed'

export type SaveResult =
  | { kind: 'no-history' }
  | { kind: 'nothing' }
  // The commit failed, usually on a pre-commit check; the data stays written but unsaved.
  | { kind: 'refused'; output: string }
  | { kind: 'saved'; online: Online; output?: string }

// True when anyone can read the repository, false when GitHub answers 404 (private or missing),
// undefined when it cannot answer (offline, rate limited).
export type PublicProbe = (repo: string) => Promise<boolean | undefined>

export const gitHubPublic: PublicProbe = async (repo) => {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  if (res?.status === 200) return true
  // Without a login GitHub answers 404 for a private repository, as for a missing one.
  return res?.status === 404 ? false : undefined
}

export type SaveOptions = {
  message: string
  // Every change in the folder, not only the data folders, for a caller about to merge: git
  // refuses to merge over unsaved changes to files the merge touches.
  everything?: boolean
  probe?: PublicProbe
  path?: string
}

// Without an email set, git may refuse to commit when it cannot work one out; until one is
// set, every save commits under a stand-in name and email, replacing any name already set.
const identity = (git: Git): string[] =>
  git(['config', 'user.email']).stdout.trim()
    ? []
    : ['-c', 'user.name=Job coach', '-c', 'user.email=job-coach@localhost']

const pathsToSave = (root: string, git: Git): string[] =>
  DATA_FOLDERS.filter(
    (dir) => existsSync(join(root, dir)) || git(['ls-files', '--', dir]).stdout.trim() !== '',
  )

// The engine is never pushed to. Another copy on GitHub is pushed to only when GitHub answers, at
// every save, that it is not public, so a copy made public after onboarding stops receiving data;
// without that answer (offline, rate limited, an address it cannot read) the push waits for the
// next save. A copy elsewhere cannot be checked, and relies on onboarding's question about whether
// it is private.
const pushOnline = async (git: Git, probe: PublicProbe): Promise<SaveResult> => {
  const origin = git(['remote', 'get-url', 'origin'])
  if (origin.status !== 0) return { kind: 'saved', online: 'no-copy' }
  const repo = gitHubRepo(origin.stdout)
  if (!repo && /(^|[@/.])github\.com/i.test(origin.stdout))
    return { kind: 'saved', online: 'unchecked' }
  if (repo?.toLowerCase() === ENGINE.toLowerCase()) return { kind: 'saved', online: 'public' }
  if (repo) {
    const isPublic = await probe(repo)
    if (isPublic === true) return { kind: 'saved', online: 'public' }
    if (isPublic === undefined) return { kind: 'saved', online: 'unchecked' }
  }
  const push = git(['push', '-q', 'origin', 'HEAD'], { GIT_TERMINAL_PROMPT: '0' })
  return push.status === 0
    ? { kind: 'saved', online: 'pushed' }
    : { kind: 'saved', online: 'failed', output: output(push) }
}

export const save = async (root: string, opts: SaveOptions): Promise<SaveResult> => {
  const git = gitIn(root, opts.path)
  if (!git) return { kind: 'no-history' }
  const paths = opts.everything ? ['.'] : pathsToSave(root, git)
  if (paths.length === 0) return { kind: 'nothing' }
  git(['add', '-A', '--', ...paths])
  // Commit the staged paths by name, not the folders: git fails a commit whose folder holds nothing
  // it tracks (empty, or only ignored files). --no-renames keeps a moved file's old path in the
  // list, so the move is committed whole.
  const staged = git(['diff', '--cached', '--no-renames', '--name-only', '-z', '--', ...paths])
    .stdout.split('\0')
    .filter(Boolean)
  if (staged.length === 0) return { kind: 'nothing' }
  const commit = git([...identity(git), 'commit', '-q', '-m', opts.message, '--', ...staged])
  if (commit.status !== 0) return { kind: 'refused', output: output(commit) }
  return pushOnline(git, opts.probe ?? gitHubPublic)
}
