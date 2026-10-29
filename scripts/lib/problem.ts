// What every check reports. `slug` names a role folder, or a repo path such as
// profile/wins.yaml or experience-bank when the problem is not about one role.
export type Problem = { slug: string; level: 'error' | 'warning'; message: string }

export const error = (slug: string, message: string): Problem => ({ slug, level: 'error', message })

export const hasErrors = (problems: Problem[]): boolean => problems.some((p) => p.level === 'error')

// One code per failure class, so the agent running a command reads the same meaning
// from every command. usage and missing are the sysexits values cv-export already
// documents; problems is any other failure of ours, not only one in the data; an
// external tool's own status passes through untouched.
export const EXIT = { usage: 64, problems: 1, missing: 66 } as const

export const printProblems = (problems: Problem[], showWarnings: boolean): void => {
  for (const p of problems.filter((x) => x.level === 'error'))
    console.error(`error  ${p.slug}: ${p.message}`)
  if (!showWarnings) return
  for (const p of problems.filter((x) => x.level === 'warning'))
    console.log(`warn   ${p.slug}: ${p.message}`)
}

// A command that hid its warnings says so, or the reader takes the count for the whole list.
export const summary = (
  problems: Problem[],
  { warningsShown }: { warningsShown: boolean },
): string => {
  const errors = problems.filter((p) => p.level === 'error').length
  const warnings = problems.length - errors
  const hint = warnings > 0 && !warningsShown ? ' (run with --warnings to list them)' : ''
  return `${errors} error(s), ${warnings} warning(s)${hint}`
}
