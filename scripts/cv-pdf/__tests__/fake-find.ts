import type { FindTools, MissingTools, ReaderSearch, ToolSearch } from '../tools.ts'

// A lookup that finds nothing it is not told about, so entry-point tests run without Chrome or
// poppler. `asked` records each call's argument, to show who looked and for what.
export const findingMissing = (
  missing: MissingTools,
): { find: FindTools; asked: (string | undefined)[] } => {
  const asked: (string | undefined)[] = []
  function find(): ToolSearch
  function find(only: 'poppler'): ReaderSearch
  function find(only?: 'poppler'): ToolSearch | ReaderSearch {
    asked.push(only)
    return { missing }
  }
  return { find, asked }
}
