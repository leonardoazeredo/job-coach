// The rule that makes a Coach update safe: it is kept only when the record check passes before it
// starts and after it is in place. Both ways of updating (a ZIP copy and a git merge) end here;
// each supplies only whether the lock file changed and how to put the old version back.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { output } from './history.ts'

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

// The check's output when the records are already broken, so an update does not start and blame
// itself for the user's own fault; undefined when they pass.
export const checkBefore = (root: string, run: Run): string | undefined => {
  const before = recordCheck(root, run)
  return before.ok ? undefined : before.output
}

export type Verified =
  | { kind: 'updated' }
  | { kind: 'undone'; output: string }
  // The check failed and putting the old version back failed too: the new one is still in place.
  | { kind: 'not-undone'; output: string }

export type Update = {
  lockChanged: boolean
  // Puts the old version back; the reason it could not, or undefined when it did.
  undo: () => string | undefined
}

// Called once the new version is in place.
export const keepOrUndo = (root: string, run: Run, update: Update): Verified => {
  const install = update.lockChanged ? run('npm', ['ci']) : { ok: true, output: '' }
  const after = install.ok ? recordCheck(root, run) : install
  if (after.ok) return { kind: 'updated' }
  const failure = update.undo()
  // The old lock file is back by now, so the old dependencies are installed again.
  if (update.lockChanged) run('npm', ['ci'])
  if (failure !== undefined) return { kind: 'not-undone', output: `${after.output}\n${failure}` }
  return { kind: 'undone', output: after.output }
}
