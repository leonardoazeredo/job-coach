// Whether the repo is public on GitHub. A user's profile, CVs and pipeline are committed
// to their own copy, so a public copy exposes personal data; check.ts warns about it and
// save.ts withholds the push. Neither needs gh: it is asked first because it can see a
// private repository, and GitHub's open API answers when it is missing.
import { spawnSync } from 'node:child_process'
import { gitHubRepo } from './history.ts'

export type RepoVisibility = 'public' | 'private'

// Undefined means it cannot be told (offline, no origin, not on GitHub): callers then stay
// quiet rather than guess.
export type VisibilityProbe = (root: string) => Promise<RepoVisibility | undefined>

// The three outside-world lookups, injectable so tests need neither gh, a remote nor a network.
export type Seams = {
  origin: (root: string) => string | undefined
  // gh's visibility word for the repo, undefined when gh is missing or not signed in.
  gh: (repo: string, root: string) => string | undefined
  // The HTTP status of an unauthenticated GET of the repo, undefined when unreachable.
  api: (repo: string) => Promise<number | undefined>
}

const realSeams: Seams = {
  origin: (root) => {
    const run = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' })
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
export const visibilityOfRepo = async (
  repo: string,
  seams: Seams = realSeams,
  root = '.',
): Promise<RepoVisibility | undefined> => {
  const word = seams.gh(repo, root)?.trim().toLowerCase()
  if (word === 'public') return 'public'
  if (word === 'private' || word === 'internal') return 'private'
  const status = await seams.api(repo)
  if (status === 200) return 'public'
  // Without a login GitHub answers 404 for a private repository, as for a missing one.
  return status === 404 ? 'private' : undefined
}

// Origin is named explicitly because gh's default repo prefers a remote called upstream,
// which in a user's copy is the public template.
export const repoVisibility = async (
  root: string,
  seams: Seams = realSeams,
): Promise<RepoVisibility | undefined> => {
  const url = seams.origin(root)
  const repo = url ? gitHubRepo(url) : undefined
  return repo ? visibilityOfRepo(repo, seams, root) : undefined
}
