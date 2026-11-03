// Engine updates: whether the upstream engine has moved on, and updating a folder that keeps no
// history (a ZIP download) by copying the new engine files over it.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { z } from 'zod'
import { ENGINE, type Git, gitIn, output } from './history.ts'

// Ignored by git and Biome: the last check date and the backups of replaced files.
export const LOCAL_DIR = '.coach'
const STATE_FILE = join(LOCAL_DIR, 'state.json')
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

export type UnknownReason = 'offline' | 'rate-limited' | 'unexpected'

export class SourceFault extends Error {
  readonly reason: UnknownReason
  constructor(reason: UnknownReason) {
    super(reason)
    this.reason = reason
  }
}

// latestCommit and latestFiles throw SourceFault when GitHub cannot be reached or read, so a
// failure is never mistaken for "nothing new".
export type EngineSource = {
  // The newest commit on the engine's main branch.
  latestCommit: () => Promise<string>
  // The git blob id of every file on the engine's main branch, by path.
  latestFiles: () => Promise<Map<string, string>>
  // Unpacks the newest engine into dest and returns the folder that holds it.
  download: (dest: string) => Promise<string>
}

const api = async (path: string): Promise<unknown> => {
  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${ENGINE}/${path}`, {
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    // DNS failure, no connection and the timeout all land here.
    throw new SourceFault('offline')
  }
  // GitHub answers an exhausted anonymous quota with 403 and the remaining count at 0.
  const exhausted = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
  if (res.status === 429 || exhausted) throw new SourceFault('rate-limited')
  if (!res.ok) throw new SourceFault('unexpected')
  try {
    return await res.json()
  } catch {
    throw new SourceFault('unexpected')
  }
}

const CommitSchema = z.object({ sha: z.string() })
const TreeSchema = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string() })),
})

export const gitHubEngine: EngineSource = {
  latestCommit: async () => {
    const body = CommitSchema.safeParse(await api('commits/main'))
    if (!body.success) throw new SourceFault('unexpected')
    return body.data.sha
  },
  latestFiles: async () => {
    const body = TreeSchema.safeParse(await api('git/trees/main?recursive=1'))
    if (!body.success) throw new SourceFault('unexpected')
    return new Map(body.data.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))
  },
  download: async (dest) => {
    const res = await fetch(`https://codeload.github.com/${ENGINE}/tar.gz/refs/heads/main`, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
    const archive = join(dest, 'engine.tar.gz')
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
    const out = join(dest, 'engine')
    mkdirSync(out)
    const tar = spawnSync('tar', ['-xzf', archive, '-C', out], { encoding: 'utf8' })
    if (tar.status !== 0) throw new Error(`unpack failed: ${tar.stderr.trim()}`)
    const [top] = readdirSync(out)
    if (!top) throw new Error('unpack failed: the archive was empty')
    return join(out, top)
  },
}

// What a Coach update may replace. Not the same set as the folders a save commits
// (`USER_DATA_FOLDERS` in save.ts): Local work files (discovery/, .coach/) are kept but never saved.
// Paths under profile/, cv/, discovery/ and .coach/ are the user's and never copied, nor are
// installed packages or git's own folder. In pipeline/ only README.md and _templates/ are engine
// files, and in experience-bank/ only README.md; the rest of those two folders is user data.
export const isEngineFile = (rel: string): boolean => {
  if (/^(profile|cv|discovery|node_modules|\.git|\.coach)\//.test(rel)) return false
  if (rel.startsWith('pipeline/'))
    return rel === 'pipeline/README.md' || rel.startsWith('pipeline/_templates/')
  if (rel.startsWith('experience-bank/')) return rel === 'experience-bank/README.md'
  return true
}

const blobId = (bytes: Buffer): string =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

type State = Record<string, unknown>

// lastUpdateCheck is the last definite answer; lastUpdateAttempt is the last failed try, kept
// apart so a failure neither counts as a completed weekly check nor is retried every session.
const DATE_KEYS = ['lastUpdateCheck', 'lastUpdateAttempt']

// A missing file is a first run. Anything else unreadable is damage, which the caller reports.
const readState = (root: string): { state: State; damaged: boolean } => {
  let text: string
  try {
    text = readFileSync(join(root, STATE_FILE), 'utf8')
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    return { state: {}, damaged: !missing }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return { state: {}, damaged: true }
    // A wrongly typed date counts as not yet checked; the other keys stay.
    const state: State = { ...parsed }
    for (const key of DATE_KEYS) if (typeof state[key] !== 'string') delete state[key]
    return { state, damaged: false }
  } catch {
    return { state: {}, damaged: true }
  }
}

// A state file that cannot be written must not stop the session; the next check just asks again.
const writeState = (root: string, state: State) => {
  try {
    mkdirSync(join(root, LOCAL_DIR), { recursive: true })
    writeFileSync(join(root, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)
  } catch {
    // Left unsaved on purpose; see above.
  }
}

export type CheckResult =
  | 'not-due'
  | 'latest'
  | 'available'
  | { kind: 'unknown'; reason: UnknownReason }

export type CheckOptions = {
  now: Date
  source: EngineSource
  force?: boolean
  path?: string | undefined
  // Called once when the state file was unreadable and has been replaced.
  onStateReset?: () => void
}

const recent = (stamp: unknown, now: Date, span: number): boolean =>
  typeof stamp === 'string' && now.getTime() - Date.parse(stamp) < span

// One read-only call to GitHub, at most once a week unless forced. Only a definite answer
// counts as the weekly check; after a failure the next try waits a day.
export const checkForUpdate = async (root: string, opts: CheckOptions): Promise<CheckResult> => {
  const { state, damaged } = readState(root)
  if (damaged) opts.onStateReset?.()
  if (
    !opts.force &&
    (recent(state.lastUpdateCheck, opts.now, WEEK_MS) ||
      recent(state.lastUpdateAttempt, opts.now, DAY_MS))
  )
    return 'not-due'
  const git = gitIn(root, opts.path)
  let result: CheckResult
  try {
    result = await (git ? checkClone(git, opts.source) : checkCopy(root, opts.source))
  } catch (error) {
    const reason = error instanceof SourceFault ? error.reason : 'unexpected'
    result = { kind: 'unknown', reason }
  }
  if (typeof result === 'object') {
    writeState(root, { ...state, lastUpdateAttempt: opts.now.toISOString() })
  } else {
    const { lastUpdateAttempt: _failed, ...kept } = state
    writeState(root, { ...kept, lastUpdateCheck: opts.now.toISOString() })
  }
  return result
}

const checkClone = async (git: Git, source: EngineSource): Promise<CheckResult> => {
  const sha = await source.latestCommit()
  // A commit this folder does not have cannot be confirmed as in HEAD's history: the folder is
  // behind it, has diverged, or is a shallow clone. All are reported as available.
  if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return 'available'
  return git(['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0 ? 'latest' : 'available'
}

const checkCopy = async (root: string, source: EngineSource): Promise<CheckResult> => {
  const files = await source.latestFiles()
  for (const [rel, id] of files) {
    if (!isEngineFile(rel)) continue
    const local = join(root, rel)
    if (!existsSync(local) || blobId(readFileSync(local)) !== id) return 'available'
  }
  return 'latest'
}

const listFiles = (dir: string, base = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return listFiles(path, base)
    return e.isFile() ? [relative(base, path)] : []
  })

export type Run = (cmd: string, args: string[]) => { ok: boolean; output: string }

export const runIn =
  (root: string): Run =>
  (cmd, args) => {
    const run = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 600_000 })
    return { ok: run.status === 0, output: output(run) }
  }

// The record check once onboarding has made a profile, else the same check on the example.
const recordCheck = (root: string, run: Run) =>
  existsSync(join(root, 'profile/identity.yaml'))
    ? run('node', ['scripts/check.ts'])
    : run('node', ['scripts/check.ts', '--root', 'examples/austin-backend'])

export type ZipResult =
  | { kind: 'latest' }
  // The check failed before anything changed, so the update did not start.
  | { kind: 'not-started'; output: string }
  | { kind: 'updated'; replaced: string[]; added: string[]; backup: string }
  // The download or unpack failed before any file was touched.
  | { kind: 'not-fetched'; output: string }
  // Every replaced file was put back and every added one removed.
  | { kind: 'undone'; output: string; backup: string }

export type ZipOptions = { now: Date; source: EngineSource; run?: Run | undefined }

type Manifest = { replaced: string[]; added: string[] }

const restore = (root: string, backup: string, manifest: Manifest) => {
  for (const rel of manifest.replaced) copyFileSync(join(root, backup, rel), join(root, rel))
  for (const rel of manifest.added) rmSync(join(root, rel), { force: true })
}

export const updateFromArchive = async (root: string, opts: ZipOptions): Promise<ZipResult> => {
  const run = opts.run ?? runIn(root)
  const before = recordCheck(root, run)
  if (!before.ok) return { kind: 'not-started', output: before.output }

  const scratch = mkdtempSync(join(tmpdir(), 'coach-update-'))
  try {
    let engine: string
    try {
      engine = await opts.source.download(scratch)
    } catch (error) {
      return { kind: 'not-fetched', output: error instanceof Error ? error.message : String(error) }
    }
    const changed = listFiles(engine)
      .filter(isEngineFile)
      .filter((rel) => {
        const local = join(root, rel)
        return !existsSync(local) || !readFileSync(local).equals(readFileSync(join(engine, rel)))
      })
    if (changed.length === 0) return { kind: 'latest' }

    const backup = join(LOCAL_DIR, 'backups', opts.now.toISOString().replace(/[:.]/g, '-'))
    const manifest: Manifest = { replaced: [], added: [] }
    mkdirSync(join(root, backup), { recursive: true })
    for (const rel of changed) {
      if (!existsSync(join(root, rel))) {
        manifest.added.push(rel)
        continue
      }
      mkdirSync(dirname(join(root, backup, rel)), { recursive: true })
      copyFileSync(join(root, rel), join(root, backup, rel))
      manifest.replaced.push(rel)
    }
    // Written before any engine file is touched, so the backup can always be undone by hand.
    writeFileSync(join(root, backup, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    for (const rel of changed) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      copyFileSync(join(engine, rel), join(root, rel))
    }

    const lockChanged = changed.includes('package-lock.json')
    const install = lockChanged ? run('npm', ['ci']) : { ok: true, output: '' }
    const after = install.ok ? recordCheck(root, run) : install
    if (after.ok) return { kind: 'updated', ...manifest, backup }
    restore(root, backup, manifest)
    if (lockChanged) run('npm', ['ci'])
    return { kind: 'undone', output: after.output, backup }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
