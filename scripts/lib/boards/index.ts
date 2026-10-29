// Every job board the pull can name, with the rules each one is built from. A board is
// built here and nowhere else in the pull, so the Search titles and the run-time note cannot drift
// between the command and the adapters.
import type { BoardDeps, JobBoard } from '../listings.ts'
import type { Rules } from '../schema.ts'
import { rocketshipBoard } from './rocketship.ts'
import { whatrunsBoard } from './whatruns.ts'

export type BoardEntry = { board: JobBoard; expected: string }
type BoardMaker = (rules: Rules, deps: BoardDeps) => BoardEntry

const BOARDS: Record<string, BoardMaker> = {
  rocketship: ({ discovery }, deps) => {
    const { search, search_titles, title_expansion } = discovery
    const searchTitles = [...search_titles, ...title_expansion]
    return {
      board: rocketshipBoard({ ...deps, search, searchTitles }),
      expected: 'under a minute',
    }
  },
  whatruns: ({ discovery }, deps) => ({
    board: whatrunsBoard({ ...deps, search: discovery.search }),
    expected: 'a few minutes',
  }),
}

export const BOARD_NAMES: string[] = Object.keys(BOARDS)

export const boardFor = (name: string, rules: Rules, deps: BoardDeps): BoardEntry | undefined => {
  // The name comes from argv, and "constructor" would otherwise find Object's.
  const make: BoardMaker | undefined = Object.hasOwn(BOARDS, name) ? BOARDS[name] : undefined
  return make?.(rules, deps)
}
