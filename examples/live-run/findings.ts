// What the scorer found, as data, and the one place that turns it into the text the judge reads.
// Every other reader (the fail rates, the comment, the replay's printout) works on rows, so none
// parses the text back.

export type Row = {
  line: number
  status: 'FAIL' | 'PASS' | 'SKIPPED' | 'INFO'
  // The turn a FAIL is about; none for a finding about a written file or for a row that is no
  // finding.
  turn?: number | undefined
  // The place of a FAIL about a written file, as `file:line`.
  where?: string | undefined
  // The quoted text of a FAIL, why a line was SKIPPED, or what an INFO row says.
  text?: string | undefined
}

export const formatRow = (r: Row): string => {
  if (r.status === 'FAIL')
    return `line ${r.line} FAIL ${r.turn === undefined ? r.where : `T${r.turn}`} "${r.text}"`
  if (r.status === 'PASS') return `line ${r.line} PASS`
  return `line ${r.line} ${r.status} ${r.text}`
}

// The findings at the replayed turn. The scorer reads the whole run, so a sample's rows also hold
// findings from the turns before it, which every sample shares.
export const failedAt = (rows: Row[], turn: number): Row[] =>
  rows.filter((r) => r.status === 'FAIL' && r.turn === turn)

// Each checklist line that has a finding, in the order first found.
export const failedLines = (rows: Row[]): number[] => [
  ...new Set(rows.filter((r) => r.status === 'FAIL').map((r) => r.line)),
]
