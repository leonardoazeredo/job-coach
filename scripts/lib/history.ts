// Whether this folder keeps a saved history (a git checkout of its own), and git run inside it.
// A folder downloaded as a ZIP, or a computer without git, keeps none.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { accessSync, constants, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export const ENGINE = 'leonardoazeredo/job-coach'
export const ENGINE_URL = `https://github.com/${ENGINE}.git`

export type Git = (args: string[], env?: NodeJS.ProcessEnv) => SpawnSyncReturns<string>

// On macOS /usr/bin/git is a stub until the developer tools are installed, and running it opens
// an install dialog. While xcode-select reports no tools, the stub is passed over for a later git
// on the path, or no git at all.
export const findGit = (path = process.env.PATH ?? ''): string | undefined => {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, 'git')
    try {
      accessSync(candidate, constants.X_OK)
    } catch {
      continue
    }
    const stub =
      process.platform === 'darwin' &&
      candidate === '/usr/bin/git' &&
      spawnSync('xcode-select', ['-p']).status !== 0
    if (!stub) return candidate
  }
  return undefined
}

// Undefined unless root is the top of its own checkout: a ZIP folder unpacked inside some other
// checkout, such as a home folder kept in git, must not save into that one.
export const gitIn = (root: string, path?: string): Git | undefined => {
  const bin = findGit(path)
  if (!bin) return undefined
  const git: Git = (args, env) =>
    spawnSync(bin, args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 600_000,
    })
  const top = git(['rev-parse', '--show-toplevel'])
  if (top.status !== 0) return undefined
  return realpathSync(top.stdout.trim()) === realpathSync(root) ? git : undefined
}

export const output = (run: SpawnSyncReturns<string>): string =>
  `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()

// owner/name from git@github.com:o/n, https://github.com/o/n and ssh://git@github.com[:port]/o/n,
// with or without .git, else undefined.
export const gitHubRepo = (url: string): string | undefined =>
  url.trim().match(/(?:^|[@/])github\.com(?::\d+)?[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1]
