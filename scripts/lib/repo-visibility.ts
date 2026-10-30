// Whether the repo is public on GitHub. A user's profile, CVs and pipeline are committed
// to their own copy, so a public copy exposes personal data; check.ts warns about it.
import { spawnSync } from 'node:child_process'

export type RepoVisibility = 'public' | 'private'

// A probe, not a constant, so tests need neither gh nor a remote.
export type VisibilityProbe = (root: string) => RepoVisibility | undefined

// Undefined when gh is missing, not signed in, or origin is absent or not on GitHub: the
// check then stays quiet rather than guessing. Origin is named explicitly because gh's
// default repo prefers a remote called upstream, which in a user's copy is the public
// template. GitHub's "internal" counts as private because only members of the
// enterprise can read it, not the public.
export const ghVisibility: VisibilityProbe = (root) => {
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (origin.status !== 0) return
  const run = spawnSync(
    'gh',
    ['repo', 'view', origin.stdout.trim(), '--json', 'visibility', '--jq', '.visibility'],
    { cwd: root, encoding: 'utf8', timeout: 10_000 },
  )
  if (run.status !== 0) return
  const value = run.stdout.trim().toLowerCase()
  if (value === 'public') return 'public'
  return value === 'private' || value === 'internal' ? 'private' : undefined
}
