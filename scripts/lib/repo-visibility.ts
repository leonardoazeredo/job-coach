// Whether the repo is public on GitHub. A user's profile, CVs and pipeline are committed
// to their own copy, so a public copy exposes personal data; check.ts warns about it.
import { spawnSync } from 'node:child_process'

export type RepoVisibility = 'public' | 'private'

// A probe, not a constant, so tests need neither gh nor a remote.
export type VisibilityProbe = (root: string) => RepoVisibility | undefined

// Undefined when gh is missing, not signed in, or the folder has no GitHub remote: the
// check then stays quiet rather than guessing. GitHub's "internal" counts as private
// because only members of the enterprise can read it, not the public.
export const ghVisibility: VisibilityProbe = (root) => {
  const run = spawnSync('gh', ['repo', 'view', '--json', 'visibility', '--jq', '.visibility'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (run.status !== 0) return
  const value = run.stdout.trim().toLowerCase()
  if (value === 'public') return 'public'
  return value === 'private' || value === 'internal' ? 'private' : undefined
}
