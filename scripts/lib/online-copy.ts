// What this folder's online copy is: whether there is one, whether it is the engine itself, and
// whether GitHub says it is public. A user's profile, CVs and pipeline are committed to their own
// copy, so a public copy exposes personal data; check.ts warns about it and save.ts withholds the
// push. Neither needs gh: it is asked first because it can see a private repository, and GitHub's
// open API answers when it is missing. Each Command turns the answer into its own policy.
import { spawnSync } from 'node:child_process'
import { ENGINE, findGit, gitHubRepo } from './history.ts'

// none: no origin. engine: the origin is the engine, which is public and known without asking.
// public, private: GitHub's answer for a copy on GitHub. unknown: on GitHub but GitHub did not
// answer (offline, rate limited) or the address cannot be read. elsewhere: not on GitHub, so it
// cannot be checked.
export type OnlineCopy = 'none' | 'engine' | 'public' | 'private' | 'unknown' | 'elsewhere'

export type OnlineCopyLookup = (root: string) => Promise<OnlineCopy>

// The three outside-world lookups, injectable so tests need neither gh, a remote nor a network.
export type Seams = {
  origin: (root: string) => string | undefined
  // gh's visibility word for the repo, undefined when gh is missing or not signed in.
  gh: (repo: string, root: string) => string | undefined
  // The HTTP status of an unauthenticated GET of the repo, undefined when unreachable.
  api: (repo: string) => Promise<number | undefined>
}

const realSeams: Seams = {
  // Through findGit, as Save's own git is, so the macOS stub that opens an install dialog is never run.
  origin: (root) => {
    const git = findGit()
    if (!git) return
    const run = spawnSync(git, ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' })
    return run.status === 0 ? run.stdout.trim() : undefined
  },
  gh: (repo, root) => {
    const run = spawnSync(
      'gh',
      ['repo', 'view', repo, '--json', 'visibility', '--jq', '.visibility'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
      },
    )
    return run.status === 0 ? run.stdout : undefined
  },
  api: async (repo) =>
    (
      await fetch(`https://api.github.com/repos/${repo}`, {
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined)
    )?.status,
}

// GitHub's "internal" counts as private because only members of the enterprise can read
// it, not the public.
const visibilityOfRepo = async (
  repo: string,
  seams: Seams,
  root: string,
): Promise<'public' | 'private' | 'unknown'> => {
  const word = seams.gh(repo, root)?.trim().toLowerCase()
  if (word === 'public') return 'public'
  if (word === 'private' || word === 'internal') return 'private'
  const status = await seams.api(repo)
  if (status === 200) return 'public'
  // Without a login GitHub answers 404 for a private repository, as for a missing one.
  return status === 404 ? 'private' : 'unknown'
}

// Origin is named explicitly because gh's default repo prefers a remote called upstream,
// which in a user's copy is the public template.
export const onlineCopy = async (root: string, seams: Seams = realSeams): Promise<OnlineCopy> => {
  const url = seams.origin(root)
  if (url === undefined) return 'none'
  const repo = gitHubRepo(url)
  if (!repo) return /(^|[@/.])github\.com/i.test(url) ? 'unknown' : 'elsewhere'
  if (repo.toLowerCase() === ENGINE.toLowerCase()) return 'engine'
  return visibilityOfRepo(repo, seams, root)
}
