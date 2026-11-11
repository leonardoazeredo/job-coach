import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseBudget,
  sampleFolder,
  sampleSpend,
  shouldStop,
  stopMessage,
  totalAfter,
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

  it('stops before the sample that would start at or over the budget', () => {
    const budget = 0.3
    const spends = [0.1, 0.1, 0.1, 0.1, 0.1]
    let spent = 0
    let stoppedAt = 0
    for (const [k, cost] of spends.entries()) {
      if (shouldStop(spent, budget)) {
        stoppedAt = k + 1
        break
      }
      spent += cost
    }
    expect(stoppedAt).toBe(4)
    expect(stopMessage(spent, budget, 4, 5)).toBe(
      'STOP: 0.300 spent, the stop is 0.3. 2 samples were not run.',
    )
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
