// Validates every pipeline folder against the rules, the profile and each role's CV files.
// Usage: node scripts/check.ts [--warnings] [--root <dir>]
// --root checks another workspace, such as examples/austin-backend, which the engine's own
// CI uses because the template ships no profile.
// Exit 1 on any error, 64 when --root has no directory argument. Warnings are printed
// with --warnings or when there are no errors.
import { resolve } from 'node:path'
import { EXIT, hasErrors, type Problem, printProblems, summary } from './lib/problem.ts'
import { type Command, openWorkspace, repoRoot } from './lib/workspace.ts'

export const check: Command = (args, workspace) => {
  const { roles, ...found } = workspace.check()
  const problems: Problem[] = [...found.problems]
  if (workspace.visibility() === 'public')
    problems.push({
      slug: 'repo',
      level: 'warning',
      message:
        'this repository is public; profile/, cv/, experience-bank/ and pipeline/ hold personal data. Make it private (gh repo edit --visibility private) before committing it',
    })
  const failed = hasErrors(problems)
  const warningsShown = args.includes('--warnings') || !failed

  printProblems(problems, warningsShown)
  console.log(`check: ${roles} roles, ${summary(problems, { warningsShown })}`)
  return failed ? EXIT.problems : 0
}

const main = async (args: string[]): Promise<number> => {
  const at = args.indexOf('--root')
  if (at === -1) return check(args, openWorkspace())
  const dir = args[at + 1]
  if (!dir || dir.startsWith('--')) {
    console.error('usage: node scripts/check.ts [--warnings] [--root <dir>]')
    return EXIT.usage
  }
  // --root skips the visibility probe. A root inside this checkout, such as
  // examples/austin-backend, has no remote of its own, so the probe would report this
  // checkout's origin, the public template. A root outside this checkout loses the
  // public-repo warning too.
  return check(
    args,
    openWorkspace(resolve(repoRoot(), dir), () => undefined),
  )
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
