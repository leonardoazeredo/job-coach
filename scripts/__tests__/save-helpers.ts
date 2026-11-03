import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'

// The hooks register in whichever test file imports this module, so every file gets a fresh
// temp directory and a git environment cut off from the machine's own.
export let dir: string
let savedEnv: NodeJS.ProcessEnv
beforeEach(() => {
  savedEnv = { ...process.env }
  // A git hook exports GIT_DIR and friends, which would point every git call here at the
  // repo being pushed instead of the temp one.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  // The machine's own git config can add hooks or an identity that the temp repos must not see.
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  dir = mkdtempSync(join(tmpdir(), 'save-'))
})
afterEach(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

export const work = () => join(dir, 'work')
export const git = (...args: string[]) =>
  execFileSync('git', ['-C', work(), ...args], { encoding: 'utf8' }).trim()
export const write = (rel: string, text: string) => {
  mkdirSync(dirname(join(work(), rel)), { recursive: true })
  writeFileSync(join(work(), rel), text)
}
export const commits = () => Number(git('rev-list', '--count', 'HEAD'))

export const checkout = () => {
  mkdirSync(work())
  execFileSync('git', ['init', '-q', '-b', 'main', work()])
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('README.md', 'engine\n')
  git('add', '.')
  git('commit', '-q', '-m', 'engine')
}

export const neverPublic = async () => false
