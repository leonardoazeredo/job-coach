// With no slug, checks every role's CV files (requirements.yaml, cv/bullets.yaml);
// with a slug, that one role's CV files. Either way the profile's own problems,
// such as experience-bank tags, are reported once. check.ts runs these same CV
// checks.
// Usage: node scripts/cv-lint.ts [<slug>] [--warnings]
import { EXIT, hasErrors, printProblems, summary } from './lib/problem.ts'
import { type Command, openWorkspace } from './lib/workspace.ts'

export const cvLint: Command = (args, workspace) => {
  const only = args.find((a) => !a.startsWith('--'))
  const { problems, checked } = workspace.lintCvs(only)
  const failed = hasErrors(problems)
  const warningsShown = args.includes('--warnings') || !failed
  printProblems(problems, warningsShown)
  console.log(`cv-lint: ${checked} role(s) with CV files, ${summary(problems, { warningsShown })}`)
  return failed ? EXIT.problems : 0
}

if (import.meta.main) process.exitCode = await cvLint(process.argv.slice(2), openWorkspace())
