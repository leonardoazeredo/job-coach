// Git for the live-run tests' throwaway repos. Every call names its folder, drops the GIT_*
// variables a hook sets (they would aim git at the real repository), and refuses to run in a
// repository outside the system's temporary folder.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { withoutGitVariables } from '../../examples/live-run/replay.ts'

const run = (cwd: string, extra: Record<string, string>, args: string[]) => {
  const env = { ...withoutGitVariables(process.env), ...extra }
  if (args[0] !== 'init') {
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, env, encoding: 'utf8' })
    const inside = realpathSync(top.stdout.trim()).startsWith(realpathSync(tmpdir()))
    if (top.status !== 0 || !inside)
      throw new Error(`${cwd} is not a repository in the temp folder`)
  }
  return spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    env,
    encoding: 'utf8',
  })
}

export const gitIn = (cwd: string, ...args: string[]) => run(cwd, {}, args)

export const gitAt =
  (date: string) =>
  (cwd: string, ...args: string[]) =>
    run(cwd, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, args)
