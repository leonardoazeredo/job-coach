import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { fakeAdapter, makeRun, runReplay } from './live-run-replay-fixture.ts'

// The replay's own rules, with the fake adapter standing in for docker, up.sh and turn.sh.
const tmp = mkdtempSync(join(tmpdir(), 'replay-seam-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
let run = ''
beforeEach(() => {
  rmSync(join(tmp, 'run'), { recursive: true, force: true })
  run = makeRun(tmp)
})

describe('the replay loop', () => {
  it('stops before the sample that would start at the budget, and says what was spent', () => {
    const r = runReplay([run, '3', '5'], { LIVE_RUN_BUDGET_USD: '0.25' }, fakeAdapter())
    expect(r.code).toBe(0)
    expect(r.out).toContain('STOP: 0.300 spent, the stop is 0.25. 2 samples were not run.')
    expect(r.out.some((l) => l.includes('over 3 replies (spend 0.300 USD'))).toBe(true)
  })

  it('does not stop at a spend just under the budget, and does at the budget itself', () => {
    const under = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '0.31' }, fakeAdapter())
    expect(under.out.some((l) => l.startsWith('STOP:'))).toBe(false)
    expect(under.out.some((l) => l.includes('over 3 replies'))).toBe(true)
    const at = runReplay([run, '3', '5'], { LIVE_RUN_BUDGET_USD: '0.3' }, fakeAdapter())
    expect(at.out).toContain('STOP: 0.300 spent, the stop is 0.3. 2 samples were not run.')
  })

  it('exits with a problem when a sample fails after others were done, and still prints those', () => {
    const adapter = fakeAdapter({ failAt: { sample: 2, spend: 0, failure: 'no container' } })
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 2 failed: no container')
    expect(r.out.some((l) => l.includes('over 1 replies (spend 0.100 USD'))).toBe(true)
  })

  it('counts what a failed sample spent, and stops on it', () => {
    const adapter = fakeAdapter({ failAt: { sample: 2, spend: 0.2, failure: 'budget' } })
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 2 failed: budget (0.200 USD already spent)')
    expect(r.out.some((l) => l.includes('(spend 0.300 USD'))).toBe(true)
  })

  it('exits with a problem and prints no results when the first sample fails', () => {
    const adapter = fakeAdapter({ failAt: { sample: 1, spend: 0, failure: 'no container' } })
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 1 failed: no container')
    expect(r.out.some((l) => l.includes('Fail rate'))).toBe(false)
  })

  it('says why the image did not build and runs no sample', () => {
    const adapter = () => ({
      build: () => 'no daemon',
      runSample: () => {
        throw new Error('must not run')
      },
    })
    const r = runReplay([run, '3', '3'], {}, adapter)
    expect(r.code).toBe(1)
    expect(r.err).toContain('the image did not build; is Docker running? no daemon')
  })
})
