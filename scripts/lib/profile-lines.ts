// What the profile command prints for a write, a drop and a refused draft, shared with the live-run
// scorer so the scorer tells those lines from a draft's summary by the same words the command prints.
import { ERROR_PREFIX } from './problem.ts'

const WRITTEN = 'written: '
const NOT_WRITTEN = 'not written: '
const DROPPED = 'dropped: '

export const writtenLine = (files: string[]) => `${WRITTEN}${files.join(', ')}`
export const notWrittenLine = (files: string[]) =>
  `${NOT_WRITTEN}the record check found problems, so ${files.join(', ')} stayed as before`
export const droppedLine = (files: string[]) => `${DROPPED}${files.join(', ')}`

export const notValuesLine = (file: string, reason: string) =>
  `${file}: the input could not be read as values: ${reason}`

// The file a refusal names is a plain path ending in a file extension, as the command always prints
// it. A line that only starts with "error", or names no such path, is not a refusal.
const PATH = '[\\w./-]+\\.\\w+'
const REFUSAL = new RegExp(
  `^(?:${ERROR_PREFIX}${PATH}: |${PATH}: the input could not be read as values: )`,
)

// A line the Draft command printed because it refused: the user's yes writes nothing from it, so a
// reply that does not relay it loses nothing.
export const isRefusalLine = (line: string) => REFUSAL.test(line)

// A line a write or a drop printed, as it can turn up in the same command's output as a draft's
// summary.
export const isWriteOrDropLine = (line: string) =>
  [WRITTEN, NOT_WRITTEN, DROPPED].some((prefix) => line.startsWith(prefix))
