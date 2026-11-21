// What the profile command prints for a write and a drop, shared with the live-run scorer so the
// scorer tells those lines from a draft's summary by the same words the command prints.
const WRITTEN = 'written: '
const NOT_WRITTEN = 'not written: '
const DROPPED = 'dropped: '

export const writtenLine = (files: string[]) => `${WRITTEN}${files.join(', ')}`
export const notWrittenLine = (files: string[]) =>
  `${NOT_WRITTEN}the record check found problems, so ${files.join(', ')} stayed as before`
export const droppedLine = (files: string[]) => `${DROPPED}${files.join(', ')}`

// A line a write or a drop printed, as it can turn up in the same command's output as a draft's
// summary.
export const isWriteOrDropLine = (line: string) =>
  [WRITTEN, NOT_WRITTEN, DROPPED].some((prefix) => line.startsWith(prefix))
