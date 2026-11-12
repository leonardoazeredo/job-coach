import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  failRates,
  formatRates,
  missingForReplay,
  parseReplayArgs,
  prepareSample,
  replayCommand,
} from '../../examples/live-run/replay.ts'
import { EXIT } from '../lib/problem.ts'
import { gitIn } from './live-run-git.ts'

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
  const sample = (...lines: string[]) => lines
  const scored = [
    sample('line 13 FAIL T4 "narrates"'),
    sample('line 13 PASS'),
    sample('line 13 FAIL T9 "an earlier turn"'),
    sample('line 13 FAIL T9 "an earlier turn"', 'line 13 FAIL T4 "again"'),
    sample('line 13 PASS'),
  ]

  it('counts only the findings at the replayed turn', () => {
    expect(failRates(4, scored)).toEqual([{ line: 13, fails: 2, samples: 5 }])
  })

  it('lists every marked line, leaving out lines about files, counts and what was skipped', () => {
    const out = [
      sample(
        'line 4 PASS',
        'line 5 FAIL T2 "x"',
        'line 18 FAIL profile/voice.md:3 "his"',
        'line 28 SKIPPED no raw/ folder',
        'line 36 INFO 40 turns',
      ),
      sample(
        'line 4 FAIL T2 "y"',
        'line 5 FAIL T2 "x"',
        'line 18 PASS',
        'line 28 SKIPPED no raw/ folder',
        'line 36 INFO 40 turns',
      ),
    ]
    expect(failRates(2, out)).toEqual([
      { line: 4, fails: 1, samples: 2 },
      { line: 5, fails: 2, samples: 2 },
      { line: 18, fails: 0, samples: 2 },
    ])
  })

  it('prints a percentage per line', () => {
    expect(formatRates(failRates(4, scored))).toBe('line 13: 2 of 5 replies failed (40%)')
  })
})

// A small invented run: three turns, a snapshot before turn 3, and an engine for an update run.
const tmp = mkdtempSync(join(tmpdir(), 'replay-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const makeRunFolder = (name: string, opts: { turn1?: boolean } = {}) => {
  const run = join(tmp, name)
  const stage = join(tmp, `${name}-stage`)
  mkdirSync(join(stage, 'copy', '.claude', 'skills', 'old'), { recursive: true })
  mkdirSync(join(stage, 'claudehome', 'projects'), { recursive: true })
  writeFileSync(join(stage, 'copy', 'CLAUDE.md'), 'old rules\n')
  writeFileSync(join(stage, 'copy', '.claude', 'skills', 'old', 'SKILL.md'), 'old skill\n')
  writeFileSync(join(stage, 'claudehome', 'projects', 's.jsonl'), '{}\n')
  gitIn(join(stage, 'copy'), 'init', '-q', '-b', 'main')
  gitIn(join(stage, 'copy'), 'add', '-A')
  gitIn(join(stage, 'copy'), 'commit', '-q', '-m', 'first')
  mkdirSync(join(run, 'snap'), { recursive: true })
  mkdirSync(join(run, 'raw'))
  mkdirSync(join(run, 'engine'))
  writeFileSync(join(run, 'engine', 'HEAD'), 'ref\n')
  spawnSync('tar', [
    '-czf',
    join(run, 'snap', opts.turn1 ? 'before1.tgz' : 'before3.tgz'),
    '-C',
    stage,
    'copy',
    'claudehome',
  ])
  // A real stream: an init line that already holds a session id, a line that is not JSON, and a
  // result line that starts with another key and carries `type` further along.
  const stream = (sid: string) =>
    [
      `{"type":"system","subtype":"init","session_id":"init-${sid}"}`,
      'not json at all',
      `{"duration_api_ms":9,"stop_reason":"end_turn","session_id":"${sid}","total_cost_usd":1,"type":"result"}`,
    ].join('\n')
  for (const n of [1, 2, 3]) {
    writeFileSync(join(run, 'raw', `turn${n}.jsonl`), `${stream(`sid-${n}`)}\n`)
    writeFileSync(join(run, 'raw', `reply${n}.txt`), `message ${n}\n`)
  }
  writeFileSync(
    join(run, 'transcript.md'),
    [1, 2, 3]
      .map(
        (n) => `## Turn ${n}\n\n**Persona:**\n\n> message ${n}\n\n**Coach:**\n\n> reply ${n}\n\n`,
      )
      .join(''),
  )
  writeFileSync(join(run, 'costlog.txt'), 'turn 1 0.5\nturn 2 0.75\nturn 3 1.5\n')
  return run
}

// Every file's path and content, so a change, an addition or a removal shows.
const fingerprint = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory()
      ? fingerprint(p)
      : [`${p} ${createHash('sha1').update(readFileSync(p)).digest('hex')}`]
  })

describe('preparing a sample', () => {
  const run = makeRunFolder('run')
  const root = join(tmp, 'tree')
  mkdirSync(join(root, '.claude', 'skills', 'new'), { recursive: true })
  writeFileSync(join(root, 'CLAUDE.md'), 'new rules\n')
  writeFileSync(join(root, '.claude', 'skills', 'new', 'SKILL.md'), 'new skill\n')
  const before = fingerprint(run)
  const sample = join(tmp, 'sample')
  prepareSample(run, 3, sample, root)

  it('leaves the run folder as it was', () => {
    expect(missingForReplay(run, 3)).toEqual([])
    expect(fingerprint(run)).toEqual(before)
  })

  it('starts from the snapshot with this checkout’s rules and skills, committed', () => {
    expect(readFileSync(join(sample, 'copy', 'CLAUDE.md'), 'utf8')).toBe('new rules\n')
    expect(readdirSync(join(sample, 'copy', '.claude', 'skills'))).toEqual(['new'])
    expect(gitIn(join(sample, 'copy'), 'status', '--short').stdout).toBe('')
    expect(gitIn(join(sample, 'copy'), 'log', '--format=%s').stdout).toContain('first')
  })

  it('resumes the session the previous turn ended with, and sends the persona’s message', () => {
    expect(readFileSync(join(sample, 'session.id'), 'utf8')).toBe('sid-2')
    expect(readFileSync(join(sample, 'reply.txt'), 'utf8')).toBe('message 3\n')
    expect(readFileSync(join(sample, 'costlog.txt'), 'utf8')).toBe('turn 2 0.75\n')
  })

  it('keeps the turns before the replayed one for the scorer, and the engine of an update run', () => {
    const transcript = readFileSync(join(sample, 'transcript.md'), 'utf8')
    expect(transcript).toContain('## Turn 2')
    expect(transcript).not.toContain('## Turn 3')
    expect(readFileSync(join(sample, 'engine', 'HEAD'), 'utf8')).toBe('ref\n')
  })

  it('refuses a stream with no result line in one plain line', () => {
    const bare = makeRunFolder('no-result')
    writeFileSync(join(bare, 'raw', 'turn2.jsonl'), '{"type":"system","session_id":"x"}\n')
    expect(() => prepareSample(bare, 3, join(tmp, 'sample-no-result'), join(tmp, 'tree'))).toThrow(
      'raw/turn2.jsonl holds no result with a session id',
    )
  })

  it('names what a run lacks for a replay', () => {
    expect(missingForReplay(run, 2)).toContain('snap/before2.tgz')
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
    const run = makeRunFolder('tokenless')
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

describe('a turn-1 sample', () => {
  it('has no session or cost log to resume and reads no turn 0', () => {
    const run = makeRunFolder('t1', { turn1: true })
    const root = join(tmp, 'tree1')
    mkdirSync(join(root, '.claude', 'skills', 'new'), { recursive: true })
    writeFileSync(join(root, 'CLAUDE.md'), 'new rules\n')
    writeFileSync(join(root, '.claude', 'skills', 'new', 'SKILL.md'), 's\n')
    const sample = join(tmp, 'sample-t1')
    prepareSample(run, 1, sample, root)
    expect(missingForReplay(run, 1)).toEqual([])
    expect(existsSync(join(sample, 'session.id'))).toBe(false)
    expect(existsSync(join(sample, 'costlog.txt'))).toBe(false)
    expect(readFileSync(join(sample, 'transcript.md'), 'utf8')).toBe('')
    expect(readFileSync(join(sample, 'copy', 'CLAUDE.md'), 'utf8')).toBe('new rules\n')
  })
})
