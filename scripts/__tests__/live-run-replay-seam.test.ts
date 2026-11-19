import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MakeAdapter } from '../../examples/live-run/replay.ts'
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
    expect(
      r.out.some((l) =>
        l.includes('over 3 replies (spend 0.300 USD, cache tokens read 15, written 21'),
      ),
    ).toBe(true)
  })

  it('stops when the spend equals the budget, and runs on when it is under it', () => {
    // 0.1 + 0.1 is exactly 0.2 in floating point, so the second sample ends at the budget itself.
    const at = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '0.2' }, fakeAdapter())
    expect(at.out).toContain('STOP: 0.200 spent, the stop is 0.2. 1 samples were not run.')
    const under = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '0.21' }, fakeAdapter())
    expect(under.out.some((l) => l.startsWith('STOP:'))).toBe(false)
    expect(under.out.some((l) => l.includes('over 3 replies'))).toBe(true)
  })

  it('exits with a problem and still prints the samples done when preparing a sample throws', () => {
    const inner = fakeAdapter()
    const adapter: MakeAdapter = (job) => {
      const a = inner(job)
      return {
        ...a,
        runSample: (sample) => {
          const r = a.runSample(sample)
          rmSync(join(job.run, 'snap', 'before3.tgz'))
          return r
        },
      }
    }
    const r = runReplay([run, '3', '3'], { LIVE_RUN_BUDGET_USD: '5' }, adapter)
    expect(r.code).toBe(1)
    expect(r.err.some((l) => l.startsWith('sample 2 failed: could not unpack the snapshot'))).toBe(
      true,
    )
    expect(r.out.some((l) => l.includes('over 1 replies (spend 0.100 USD'))).toBe(true)
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
