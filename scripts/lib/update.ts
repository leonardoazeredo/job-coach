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
import { ENGINE, gitIn } from './history.ts'

// Ignored by git and Biome: the last check date and the backups of replaced files.
export const LOCAL_DIR = '.coach'
const STATE_FILE = join(LOCAL_DIR, 'state.json')
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type EngineSource = {
  // The newest commit on the engine's main branch.
  latestCommit: () => Promise<string | undefined>
  // The git blob id of every file on the engine's main branch, by path.
  latestFiles: () => Promise<Map<string, string> | undefined>
  // Unpacks the newest engine into dest and returns the folder that holds it.
  download: (dest: string) => Promise<string>
}

const api = async (path: string): Promise<unknown> => {
  const res = await fetch(`https://api.github.com/repos/${ENGINE}/${path}`, {
    signal: AbortSignal.timeout(15_000),
  })
  return res.ok ? res.json() : undefined
}

export const gitHubEngine: EngineSource = {
  latestCommit: async () => {
    const body = (await api('commits/main').catch(() => undefined)) as { sha?: string } | undefined
    return body?.sha
  },
  latestFiles: async () => {
    const body = (await api('git/trees/main?recursive=1').catch(() => undefined)) as
      | { tree?: { path: string; type: string; sha: string }[] }
      | undefined
    if (!body?.tree) return
    return new Map(body.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]))
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

type State = { lastUpdateCheck?: string }

const readState = (root: string): State => {
  try {
    return JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8')) as State
  } catch {
    return {}
  }
}

const writeState = (root: string, state: State) => {
  mkdirSync(join(root, LOCAL_DIR), { recursive: true })
  writeFileSync(join(root, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)
}

export type CheckResult = 'not-due' | 'unknown' | 'latest' | 'available'

export type CheckOptions = {
  now: Date
  source: EngineSource
  force?: boolean
  path?: string | undefined
}

// One read-only call to GitHub, at most once a week unless forced. The date is recorded even
// when the call fails, so an offline computer is not asked again every session.
export const checkForUpdate = async (root: string, opts: CheckOptions): Promise<CheckResult> => {
  const last = readState(root).lastUpdateCheck
  if (!opts.force && last && opts.now.getTime() - Date.parse(last) < WEEK_MS) return 'not-due'
  writeState(root, { ...readState(root), lastUpdateCheck: opts.now.toISOString() })
  const git = gitIn(root, opts.path)
  if (git) {
    const sha = await opts.source.latestCommit()
    if (!sha) return 'unknown'
    // A commit this folder does not have cannot be confirmed as in HEAD's history: the folder is
    // behind it, has diverged, or is a shallow clone. All are reported as available.
    if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return 'available'
    return git(['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0 ? 'latest' : 'available'
  }
  const files = await opts.source.latestFiles()
  if (!files) return 'unknown'
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
    return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() }
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
