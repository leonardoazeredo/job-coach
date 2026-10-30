import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { repoRoot } from '../lib/workspace.ts'

const exitCode = (script: string, args: string[]): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repoRoot(), 'scripts', script), ...args], {
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('close', resolve)
  })

// The in-process tests never run the `import.meta.main` line, so this is the one place
// that pins it. Each usage error is refused before the command reads data or reaches the
// network, so the real scripts/ are safe to run here.
// cv-lint.ts takes no usage error and runs only against the real repo, so it is not spawned.
const usageErrors: [string, string[]][] = [
  ['board.ts', ['--today=27/10/2026']],
  ['check.ts', ['--root']],
  ['cv-build.ts', []],
  ['cv-evidence.ts', []],
  ['cv-export.ts', []],
  ['discovery/pull.ts', []],
  ['discovery/shortlist.ts', []],
  ['save.ts', []],
  ['update.ts', []],
]

describe('command entry lines', () => {
  it('start every command, which refuses a usage error with exit 64', async () => {
    const codes = await Promise.all(usageErrors.map(([script, args]) => exitCode(script, args)))
    expect(codes).toEqual(usageErrors.map(() => EXIT.usage))
    // Nine node start-ups race the other test files for CPU, so the 5s default flakes under the
    // pre-push run.
  }, 30_000)

  it('check.ts --root checks that workspace instead of the repo', async () => {
    expect(
      await exitCode('check.ts', ['--root', join(repoRoot(), 'examples/austin-backend')]),
    ).toBe(0)
  })
})
