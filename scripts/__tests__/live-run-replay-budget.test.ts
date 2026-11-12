import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseBudget,
  replaySamples,
  sampleFolder,
  sampleSpend,
  totalAfter,
  turnBudget,
} from '../../examples/live-run/replay.ts'

describe('the budget', () => {
  const log = 'turn 1 0.5\nturn 2 0.75\nturn 3 1.5\n'

  it('is what a sample spent: its total at the turn less the total before it', () => {
    expect(sampleSpend(log, 3, 0.75)).toBeCloseTo(0.75)
    expect(sampleSpend('turn 1 0.3\n', 1, 0)).toBeCloseTo(0.3)
    expect(totalAfter(log, 2)).toBe(0.75)
  })

  it('refuses a cost log with no line for the turn, never a negative spend', () => {
    expect(() => sampleSpend(log, 4, 1.5)).toThrow(/no cost for turn 4/)
    expect(() => sampleSpend('turn 4 abc\n', 4, 0)).toThrow(/no cost/)
  })

  it('defaults to 5 and accepts only a number above 0', () => {
    expect(parseBudget(undefined)).toBe(5)
    expect(parseBudget('2.5')).toBe(2.5)
    for (const bad of ['abc', 'NaN', '0', '-1', '', ' '])
      expect(parseBudget(bad), bad).toMatch(/LIVE_RUN_BUDGET_USD must be a number above 0/)
  })

  it('refuses a total below the base', () => {
    expect(() => sampleSpend(log, 2, 0.8)).toThrow(/below/)
  })

  it('hands turn.sh the run total before the turn plus the replay budget', () => {
    expect(turnBudget(0.75, 2)).toBe(2.75)
    expect(turnBudget(0, 5)).toBe(5)
    expect(sampleSpend('turn 1 0.3\n', 1, 0)).toBeCloseTo(0.3)
  })
})

describe('the sample loop', () => {
  it('stops before the sample that would start at the budget, and the remainder shrinks', () => {
    const seen: number[] = []
    const r = replaySamples({
      n: 5,
      budget: 0.3,
      runOne: (i, remaining) => {
        seen.push(remaining)
        return { sample: `s${i}`, spend: 0.1 }
      },
    })
    expect(r.done).toEqual(['s1', 's2', 's3'])
    expect(seen[0]).toBe(0.3)
    expect(seen[1]).toBeCloseTo(0.2)
    expect(seen[2]).toBeCloseTo(0.1)
    expect(r.stop).toBe('STOP: 0.300 spent, the stop is 0.3. 2 samples were not run.')
  })

  it('keeps the samples done when a later one throws', () => {
    const r = replaySamples({
      n: 3,
      budget: 5,
      runOne: (i) => {
        if (i === 2) throw new Error('no container')
        return { sample: `s${i}`, spend: 0.2 }
      },
    })
    expect(r.done).toEqual(['s1'])
    expect(r.spent).toBeCloseTo(0.2)
    expect(r.error).toBe('sample 2 failed: no container')
  })

  it('leaves nothing done when the first throws', () => {
    const r = replaySamples({
      n: 3,
      budget: 5,
      runOne: () => {
        throw new Error('no container')
      },
    })
    expect(r.done).toEqual([])
    expect(r.error).toMatch(/sample 1 failed/)
  })
})

describe('the sample folders', () => {
  it('are named uniquely across replays, so their containers are', () => {
    const a = mkdtempSync(join(tmpdir(), 'replay-x-t1-'))
    const b = mkdtempSync(join(tmpdir(), 'replay-x-t1-'))
    const names = [1, 2]
      .flatMap((i) => [sampleFolder(a, i), sampleFolder(b, i)])
      .map((p) => p.split('/').pop())
    expect(new Set(names).size).toBe(4)
    rmSync(a, { recursive: true })
    rmSync(b, { recursive: true })
  })
})
