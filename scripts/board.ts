// Prints the pipeline board computed from pipeline/*/record.yaml.
// Usage: node scripts/board.ts [--today=YYYY-MM-DD] [--json]
// Without --today, today is the day in the timezone in profile/identity.yaml.
// Exit 64 on a --today that is not an ISO day. Exit 0 with only the onboarding list when the
// board cannot be computed and profile/identity.yaml or profile/search.yaml is missing, even if
// a rules problem is also present. Otherwise exit 1 when that timezone cannot be read, or when
// config/rules.yaml cannot be read or is inconsistent, such as a status in no board group or in
// two, whatever other profile files are missing.
import { isDay } from './lib/dates.ts'
import { boardInputsMissing, renderOnboarding, worthListing } from './lib/onboarding.ts'
import { EXIT, type Problem, printProblems } from './lib/problem.ts'
import { renderBoard } from './lib/render.ts'
import { type Command, openWorkspace } from './lib/workspace.ts'

export const board: Command = (args, workspace) => {
  const given = args.find((a) => a.startsWith('--today='))?.slice('--today='.length)
  if (given !== undefined && !isDay(given)) {
    console.error(`board: --today must be YYYY-MM-DD, got "${given}"`)
    return EXIT.usage
  }

  const onboarding = workspace.onboarding()
  const json = args.includes('--json')
  // A board that fails with identity.yaml or search.yaml absent is the user's next step, not an
  // error, so the unfinished sections are the whole output.
  const notYet = (problems: Problem[]): number => {
    if (!boardInputsMissing(onboarding)) {
      printProblems(problems, true)
      return EXIT.problems
    }
    process.stdout.write(
      json ? `${JSON.stringify({ onboarding }, null, 2)}\n` : renderOnboarding(onboarding),
    )
    return 0
  }

  const local = workspace.today({ given })
  if (!local.today) return notYet(local.problems)

  const { board, problems } = workspace.board(local.today)
  if (!board) return notYet(problems)
  const listed = worthListing(onboarding) ? onboarding : []
  if (json) console.log(JSON.stringify({ ...board, onboarding: listed }, null, 2))
  else
    process.stdout.write(
      renderBoard(board) + (listed.length > 0 ? `\n${renderOnboarding(listed)}` : ''),
    )
  return 0
}

if (import.meta.main) process.exitCode = await board(process.argv.slice(2), openWorkspace())
