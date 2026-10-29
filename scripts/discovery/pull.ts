// Pulls one job board's listings and saves them as JSON for shortlist.ts.
// Usage: node scripts/discovery/pull.ts <rocketship|whatruns> out.json
// Exit 64 on bad arguments, 1 when the pull fails or its listings cannot be written,
// or when config/rules.yaml, which holds every board's search, cannot be read.
import { BOARD_NAMES, boardFor } from '../lib/boards/index.ts'
import { type BoardDeps, type Listing, savePull } from '../lib/listings.ts'
import { EXIT, printProblems } from '../lib/problem.ts'
import { openWorkspace, type Workspace } from '../lib/workspace.ts'

const clock = (): string => new Date().toTimeString().slice(0, 8)
const realDeps: BoardDeps = {
  fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.error(`${clock()} ${line}`),
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// The deps are a parameter so a test can answer the board without the network.
export const pull = async (
  args: string[],
  workspace: Workspace,
  deps: BoardDeps = realDeps,
): Promise<number> => {
  const [name, out] = args
  if (!name || !out || !BOARD_NAMES.includes(name)) {
    console.error(`usage: node scripts/discovery/pull.ts <${BOARD_NAMES.join('|')}> out.json`)
    return EXIT.usage
  }
  // A failure must be told even when the caller gave no progress log.
  const log = deps.log ?? ((line: string): void => console.error(line))

  const { rules, problems } = workspace.rules()
  if (!rules) {
    printProblems(problems, true)
    return EXIT.problems
  }
  const picked = boardFor(name, rules, deps)
  if (!picked) return EXIT.problems
  const { board, expected } = picked
  const started = Date.now()
  log(`pull ${board.name}: ${expected}; progress follows here, listings go to ${out}`)
  let listings: Listing[] = []
  try {
    listings = await board.pull()
  } catch (e) {
    log(`pull ${board.name} failed: ${message(e)}`)
    return EXIT.problems
  }
  const unsaved = savePull(out, listings)
  if (unsaved.length > 0) {
    log(
      `${listings.length} listings pulled but not saved to ${out}: ${unsaved.map((p) => p.message).join('; ')}`,
    )
    return EXIT.problems
  }
  log(
    `saved ${listings.length} listings to ${out} in ${Math.round((Date.now() - started) / 1000)}s`,
  )
  return 0
}

if (import.meta.main) process.exitCode = await pull(process.argv.slice(2), openWorkspace())
