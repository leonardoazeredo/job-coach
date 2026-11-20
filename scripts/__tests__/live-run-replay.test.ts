import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Row } from '../../examples/live-run/findings.ts'
import {
  failRates,
  formatRates,
  parseReplayArgs,
  prepareSample,
  replayCommand,
} from '../../examples/live-run/replay.ts'
import { EXIT } from '../lib/problem.ts'
import { gitIn } from './live-run-git.ts'
import { loadX, makeRun } from './live-run-replay-fixture.ts'

describe('the replay arguments', () => {
  it('takes a run folder, a turn and a count that defaults to 5', () => {
    expect(parseReplayArgs(['run', '3'])).toEqual({ run: 'run', turn: 3, n: 5 })
    expect(parseReplayArgs(['run', '12', '8'])).toEqual({ run: 'run', turn: 12, n: 8 })
  })

  it('refuses a missing, extra or non-numeric argument with the usage line', () => {
    for (const args of [
      [],
      ['run'],
      ['run', '0'],
      ['run', 'two'],
      ['run', '1', '0'],
      ['run', '1', '2', '3'],
      ['--x', '1'],
    ])
      expect(parseReplayArgs(args), args.join(' ')).toMatch(/usage: /)
  })

  it('exits 64 on bad arguments and 66 on a folder that cannot replay', () => {
    expect(replayCommand(['run'])).toBe(EXIT.usage)
    expect(replayCommand(['/nonexistent-run-folder', '1'])).toBe(EXIT.missing)
  })
})

describe('the fail rate', () => {
  const fail = (line: number, turn: number, text = 'x'): Row => ({
    line,
    status: 'FAIL',
    turn,
    text,
  })
  const pass = (line: number): Row => ({ line, status: 'PASS' })
  const scored: Row[][] = [
    [fail(13, 4, 'narrates')],
    [pass(13)],
    [fail(13, 9, 'an earlier turn')],
    [fail(13, 9, 'an earlier turn'), fail(13, 4, 'again')],
    [pass(13)],
  ]

  it('counts only the findings at the replayed turn', () => {
    expect(failRates(4, scored)).toEqual([{ line: 13, fails: 2, samples: 5 }])
  })

  it('lists every marked line, leaving out lines about files, counts and what was skipped', () => {
    const file = (line: number): Row => ({
      line,
      status: 'FAIL',
      where: 'profile/voice.md:3',
      text: 'his',
    })
    const skipped = (line: number): Row => ({ line, status: 'SKIPPED', text: 'no raw/ folder' })
    const info: Row = { line: 36, status: 'INFO', text: '40 turns' }
    const out: Row[][] = [
      [pass(4), fail(5, 2), file(18), skipped(28), info],
      [fail(4, 2, 'y'), fail(5, 2), pass(18), skipped(28), info],
    ]
    expect(failRates(2, out)).toEqual([
      { line: 4, fails: 1, samples: 2 },
      { line: 5, fails: 2, samples: 2 },
      { line: 18, fails: 0, samples: 2 },
    ])
  })

  it('does not take turn 1 for turn 10', () => {
    expect(failRates(1, [[fail(4, 10)], [pass(4)]])).toEqual([{ line: 4, fails: 0, samples: 2 }])
  })

  it('prints a percentage per line', () => {
    expect(formatRates(failRates(4, scored))).toBe('line 13: 2 of 5 replies failed (40%)')
  })
})

const tmp = mkdtempSync(join(tmpdir(), 'replay-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

// Every file's path and content, so a change, an addition or a removal shows.
const fingerprint = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory()
      ? fingerprint(p)
      : [`${p} ${createHash('sha1').update(readFileSync(p)).digest('hex')}`]
  })

// What the snapshot-to-sample round trip checks lives in live-run-run-folder.test.ts; these are the
// parts replay.ts adds on top: this checkout’s wording, put in after the swap.
describe('preparing a sample', () => {
  const tree = (name: string, skill: string, body: string) => {
    const root = join(tmp, name)
    mkdirSync(join(root, '.claude', 'skills', skill), { recursive: true })
    writeFileSync(join(root, 'CLAUDE.md'), 'new rules\n')
    writeFileSync(join(root, '.claude', 'skills', skill, 'SKILL.md'), body)
    return root
  }

  it('starts from the snapshot with this checkout’s rules and skills, committed', () => {
    const sample = join(tmp, 'sample')
    prepareSample(makeRun(tmp), 3, sample, tree('tree', 'new', 'new skill\n'))
    expect(readFileSync(join(sample, 'copy', 'CLAUDE.md'), 'utf8')).toBe('new rules\n')
    expect(readdirSync(join(sample, 'copy', '.claude', 'skills'))).toEqual(['new'])
    expect(gitIn(join(sample, 'copy'), 'status', '--short').stdout).toBe('')
    expect(gitIn(join(sample, 'copy'), 'log', '--format=%s').stdout).toContain('first')
  })

  it('swaps a loaded skill in the sample’s session only, before the tree’s skills go in', () => {
    const swapRun = makeRun(tmp, { name: 'swap-run', loadedSkill: true })
    const swapRoot = tree('swap-tree', 'x', 'x new body\n')
    const untouched = fingerprint(swapRun)
    const swapSample = join(tmp, 'swap-sample')
    expect(prepareSample(swapRun, 3, swapSample, swapRoot)).toEqual(['x'])
    const session = join(swapSample, 'claudehome', 'projects', '-w', 's.jsonl')
    expect(readFileSync(session, 'utf8')).toBe(`${loadX('x new body\n')}\n`)
    expect(fingerprint(swapRun)).toEqual(untouched)
  })
})

describe('the replay command before any live call', () => {
  const secret = 'sk-test-secret-value'
  const withToken = (value: string | undefined, f: () => void) => {
    const old = process.env.CLAUDE_CODE_OAUTH_TOKEN
    if (value === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = value
    try {
      f()
    } finally {
      if (old === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = old
    }
  }

  it('reports a run folder without the snapshot as missing, with no token needed', () => {
    const run = mkdtempSync(join(tmpdir(), 'replay-bare-'))
    withToken(undefined, () => expect(replayCommand([run, '2'])).toBe(EXIT.missing))
    rmSync(run, { recursive: true })
  })

  it('refuses a missing token before any Docker call, and never prints a token', () => {
    const run = makeRun(tmp, { name: 'tokenless' })
    const out: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((m) => void out.push(String(m)))
    withToken(undefined, () => expect(replayCommand([run, '3'])).toBe(EXIT.usage))
    withToken(secret, () => {
      process.env.LIVE_RUN_BUDGET_USD = 'abc'
      try {
        expect(replayCommand([run, '3'])).toBe(EXIT.usage)
      } finally {
        delete process.env.LIVE_RUN_BUDGET_USD
      }
    })
    spy.mockRestore()
    expect(out.join('\n')).not.toContain(secret)
    expect(out.join('\n')).toMatch(/LIVE_RUN_BUDGET_USD/)
  })
})
