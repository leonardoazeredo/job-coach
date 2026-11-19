import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { type EngineSource, SourceFault } from '../lib/update.ts'
import type { Run } from '../lib/verified-update.ts'

// The hooks register in whichever test file imports this module, so every file gets a fresh
// temp directory and a git environment cut off from the machine's own.
export let dir: string
let savedEnv: NodeJS.ProcessEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  // A git hook exports GIT_DIR and friends, which would point every git call here at the
  // repo being pushed instead of the temp one; the machine's own config could add hooks.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  dir = mkdtempSync(join(tmpdir(), 'update-'))
})
afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

export const put = (base: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(base, rel)), { recursive: true })
    writeFileSync(join(base, rel), text)
  }
}
export const work = () => join(dir, 'work')
export const upstream = () => join(dir, 'upstream')
export const read = (rel: string) => readFileSync(join(work(), rel), 'utf8')

export const DATA = {
  'profile/identity.yaml': 'name: Mira\n',
  'profile/glossary.md': '**Target company**:\nA company Mira names.\n',
  'cv/master.json': '{"name":"Mira"}\n',
  'pipeline/acme/record.yaml': 'status: Applied\n',
  'experience-bank/acme.md': 'notes\n',
}
export const OLD_ENGINE = {
  'CLAUDE.md': 'old prompt\n',
  'config/rules.yaml': 'stale_after_days: 14\n',
  'pipeline/README.md': 'old pipeline readme\n',
  'package-lock.json': '{"v":1}\n',
}

// Upstream also ships its own copies of data paths, to prove they are never copied.
export const NEW_ENGINE = {
  'CLAUDE.md': 'new prompt\n',
  'config/rules.yaml': 'stale_after_days: 21\n',
  'pipeline/README.md': 'old pipeline readme\n',
  'package-lock.json': '{"v":1}\n',
  '.claude/skills/update-coach/SKILL.md': 'new skill\n',
  'profile/identity.yaml': 'name: Someone Else\n',
  'profile/glossary.md': 'upstream term\n',
  'pipeline/acme/record.yaml': 'status: Rejected\n',
}

export const source = (latest: Partial<EngineSource> = {}): EngineSource => ({
  latestCommit: async () => {
    throw new SourceFault('unexpected')
  },
  latestFiles: async () => {
    throw new SourceFault('unexpected')
  },
  download: async (dest) => {
    cpSync(upstream(), join(dest, 'job-coach-main'), { recursive: true })
    return join(dest, 'job-coach-main')
  },
  ...latest,
})

// Records each command; the record check fails when told to, before or after the update.
export const runner = (fails: (call: number) => boolean = () => false) => {
  const calls: string[] = []
  const run: Run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    return { ok: !fails(calls.length), output: 'pipeline/acme: status is not a known status' }
  }
  return { run, calls }
}

export const now = new Date('2026-10-29T09:00:00Z')

// A folder that keeps history, with the engine as its upstream, for the updates that merge.
export const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
export const identify = (cwd: string) => {
  g(cwd, 'config', 'user.email', 'test@example.com')
  g(cwd, 'config', 'user.name', 'Test')
}
export const commitAll = (cwd: string, message: string, env: NodeJS.ProcessEnv = {}) => {
  g(cwd, 'add', '-A')
  execFileSync('git', ['commit', '-q', '-m', message], { cwd, env: { ...process.env, ...env } })
}
export const engineCommit = (files: Record<string, string>, message: string) => {
  put(upstream(), files)
  commitAll(upstream(), message)
}
export const userCommit = (files: Record<string, string>, message: string) => {
  put(work(), files)
  commitAll(work(), message)
}
export const head = () => g(work(), 'rev-parse', 'HEAD')
export const merging = () => existsSync(join(work(), '.git/MERGE_HEAD'))

export const startEngine = () => {
  put(upstream(), OLD_ENGINE)
  g(upstream(), 'init', '-q', '-b', 'main')
  identify(upstream())
  // Dated well before any copy, so the copy's own first commit cannot share its second.
  const past = '2026-01-01T00:00:00Z'
  commitAll(upstream(), 'Engine', { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past })
}
// A folder that already shares history with the engine, as after its first update.
export const cloned = (engineFiles: Record<string, string> = {}) => {
  startEngine()
  if (Object.keys(engineFiles).length) engineCommit(engineFiles, 'More engine')
  g(dir, 'clone', '-q', upstream(), work())
  identify(work())
  userCommit(DATA, 'Saved: profile')
}
// A copy made with "Use this template": the engine's files, but a history of its own.
export const templated = () => {
  startEngine()
  put(work(), { ...OLD_ENGINE, ...DATA })
  g(work(), 'init', '-q', '-b', 'main')
  identify(work())
  commitAll(work(), 'Initial commit')
}
