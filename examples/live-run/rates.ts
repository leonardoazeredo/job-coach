import { failedAt, type Row } from './findings.ts'

// The scorer reads the whole run, so a sample's output also holds findings from the turns before
// the replayed one, which every sample shares. A line gets a row when a sample passed it or failed
// it at any turn, so a line the scorer checks never goes missing; only a failure at the replayed
// turn counts toward its fail rate. A failure about a written file carries no turn, so it neither
// adds a row nor counts as a fail; such a line that passes still gets a row, always at 0. The turn
// count gets no row.
export const failRates = (
  turn: number,
  scored: Row[][],
): { line: number; fails: number; samples: number }[] => {
  const marked = new Set<number>()
  const failed = scored.map(() => new Set<number>())
  scored.forEach((rows, i) => {
    for (const r of rows)
      if (r.status === 'PASS' || (r.status === 'FAIL' && r.turn !== undefined)) marked.add(r.line)
    for (const r of failedAt(rows, turn)) failed[i]?.add(r.line)
  })
  return [...marked]
    .sort((a, b) => a - b)
    .map((line) => ({
      line,
      fails: failed.filter((f) => f.has(line)).length,
      samples: scored.length,
    }))
}

export const formatRates = (rates: ReturnType<typeof failRates>): string =>
  rates
    .map(
      (r) =>
        `line ${r.line}: ${r.fails} of ${r.samples} replies failed (${Math.round((100 * r.fails) / r.samples)}%)`,
    )
    .join('\n')
