// The line a scorer finding is about, its verdict, and the turn it names (none for a finding about
// a written file or the turn count).
const VERDICT = /^line (\d+) (FAIL|PASS|SKIPPED|INFO)(?: T(\d+))?/

// The scorer reads the whole run, so a sample's output also holds findings from the turns before
// the replayed one, which every sample shares. A line gets a row when a sample passed it or failed
// it at any turn, so a line the scorer checks never goes missing; only a failure at the replayed
// turn counts toward its fail rate. A failure about a written file carries no turn, so it neither
// adds a row nor counts as a fail; such a line that passes still gets a row, always at 0. The turn
// count gets no row.
export const failRates = (
  turn: number,
  scored: string[][],
): { line: number; fails: number; samples: number }[] => {
  const marked = new Set<number>()
  const failed = scored.map(() => new Set<number>())
  scored.forEach((out, i) => {
    for (const l of out) {
      const m = VERDICT.exec(l)
      if (!m) continue
      const line = Number(m[1])
      if (m[2] === 'PASS' || (m[2] === 'FAIL' && m[3] !== undefined)) marked.add(line)
      if (m[2] === 'FAIL' && Number(m[3]) === turn) failed[i]?.add(line)
    }
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
