import { describe, expect, it } from 'vitest'
import { parseBudget, sampleSpend } from '../../examples/live-run/replay.ts'
import { totalAfter } from '../../examples/live-run/run-folder.ts'

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
})
