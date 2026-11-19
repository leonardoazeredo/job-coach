import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dockerStandIn, makeRun, runReplay } from './live-run-replay-fixture.ts'

// The real adapter: replay.ts, up.sh and turn.sh run for real; only the docker command is a
// stand-in on PATH. A change to what turn.sh writes or passes on has to fail one of these.
const tmp = mkdtempSync(join(tmpdir(), 'replay-docker-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const docker = dockerStandIn(tmp)
let run = ''
beforeEach(() => {
  for (const f of ['run', 'docker.log', 'docker.log.n'])
    rmSync(join(tmp, f), { recursive: true, force: true })
  run = makeRun(tmp)
})

const env = (extra: Record<string, string> = {}) => ({
  PATH: `${docker.bin}:${process.env.PATH}`,
  FAKE_DOCKER_LOG: docker.log,
  FAKE_COST_BASE: '0.75',
  ...extra,
})
const dockerLines = (verb: string) =>
  existsSync(docker.log)
    ? readFileSync(docker.log, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith(`${verb} `))
    : []
const sampleFolders = (out: string[]) => {
  const line = out.find((l) => l.trim().startsWith('Samples are in ')) ?? ''
  return line.trim().replace('Samples are in ', '')
}

describe('the real sample runner', () => {
  it.each([
    ['0.25', '1'],
    ['2', '2.75'],
  ])(
    'hands claude the run total before the turn plus the budget %s: %s, for every sample',
    (budget, flag) => {
      const r = runReplay([run, '3', '3'], env({ LIVE_RUN_BUDGET_USD: budget }))
      expect(r.code).toBe(0)
      const flags = dockerLines('exec').map((l) => /--max-budget-usd (\S+)/.exec(l)?.[1])
      expect(flags).toEqual([flag, flag, flag])
      // Every sample resumes the run's own session, not a fresh one.
      for (const l of dockerLines('exec')) expect(l).toContain('--resume sid-2')
    },
  )

  it('leaves what turn.sh keeps: the session id, the cost line and the spend', () => {
    const r = runReplay([run, '3', '2'], env({ LIVE_RUN_BUDGET_USD: '5' }))
    expect(r.code).toBe(0)
    const out = sampleFolders(r.out)
    for (const i of [1, 2]) {
      const sample = join(out, `${out.split('/').pop()}-s${i}`)
      expect(readFileSync(join(sample, 'session.id'), 'utf8')).toBe('sid-new')
      expect(readFileSync(join(sample, 'costlog.txt'), 'utf8')).toBe('turn 2 0.75\nturn 3 0.85\n')
    }
    expect(r.out.some((l) => l.includes('over 2 replies (spend 0.200 USD'))).toBe(true)
  })

  it('stops between samples on what they spent', () => {
    const r = runReplay([run, '3', '5'], env({ LIVE_RUN_BUDGET_USD: '0.25' }))
    expect(r.out).toContain('STOP: 0.300 spent, the stop is 0.25. 2 samples were not run.')
    expect(dockerLines('exec')).toHaveLength(3)
    // Each container holds the token until it is removed, so every one started is removed.
    const started = dockerLines('run').map((l) => /--name (\S+)/.exec(l)?.[1])
    const removed = dockerLines('rm').map((l) => l.replace('rm -f ', ''))
    expect(started).toHaveLength(3)
    expect(removed).toEqual(started)
  })

  it('counts a sample that claude ended on its budget, and does not call it done', () => {
    const r = runReplay([run, '3', '3'], env({ LIVE_RUN_BUDGET_USD: '5', FAKE_BUDGET_ON: '2' }))
    expect(r.code).toBe(1)
    const failure = r.err.find((l) => l.startsWith('sample 2 failed')) ?? ''
    expect(failure).toMatch(
      /turn\.sh failed \(exit 1\): the turn ended on an error or its budget; see the result in .*\/raw\/turn3\.jsonl/,
    )
    expect(failure).not.toMatch(/0\.95/)
    expect(r.err.some((l) => l.includes('(0.200 USD already spent)'))).toBe(true)
    expect(r.out.some((l) => l.includes('over 1 replies (spend 0.300 USD'))).toBe(true)
  })

  it('names the explanation turn.sh gave and the file that holds the cause when claude left nothing', () => {
    const r = runReplay([run, '3', '3'], env({ LIVE_RUN_BUDGET_USD: '5', FAKE_DIE_ON: '2' }))
    expect(r.code).toBe(1)
    const failure = r.err.find((l) => l.startsWith('sample 2 failed')) ?? ''
    expect(failure).toMatch(
      /^sample 2 failed: turn\.sh failed \(exit 1\): turn 3 left no result; [^;]*\/raw\/turn3\.err holds why$/,
    )
  })

  it('says it could not start when the container does not', () => {
    const r = runReplay([run, '3', '3'], env({ FAKE_RUN: 'fail' }))
    expect(r.code).toBe(1)
    expect(r.err).toContain('sample 1 failed: the sample container did not start')
  })

  it('shows the error docker gave when the image does not build', () => {
    const r = runReplay([run, '3', '3'], env({ FAKE_BUILD: 'fail' }))
    expect(r.code).toBe(1)
    expect(r.err.join('\n')).toContain('Cannot connect to the Docker daemon')
  })

  it('gives each sample a container name no other replay has', () => {
    const names = [1, 2].flatMap(() => {
      rmSync(docker.log, { force: true })
      rmSync(`${docker.log}.n`, { force: true })
      rmSync(join(tmp, 'run'), { recursive: true, force: true })
      const again = makeRun(tmp)
      runReplay([again, '3', '2'], env({ LIVE_RUN_BUDGET_USD: '5' }))
      return dockerLines('run').map((l) => /--name (\S+)/.exec(l)?.[1])
    })
    expect(names).toHaveLength(4)
    expect(new Set(names).size).toBe(4)
  })
})
