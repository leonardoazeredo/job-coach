import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  failRates,
  formatRates,
  missingForReplay,
  parseReplayArgs,
  prepareSample,
  replayCommand,
} from '../../examples/live-run/replay.ts'
import { EXIT } from '../lib/problem.ts'

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
const git = (cwd: string, ...a: string[]) =>
  spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { cwd })

const makeRun = () => {
  const run = join(tmp, 'run')
  const stage = join(tmp, 'stage')
  mkdirSync(join(stage, 'copy', '.claude', 'skills', 'old'), { recursive: true })
  mkdirSync(join(stage, 'claudehome', 'projects'), { recursive: true })
  writeFileSync(join(stage, 'copy', 'CLAUDE.md'), 'old rules\n')
  writeFileSync(join(stage, 'copy', '.claude', 'skills', 'old', 'SKILL.md'), 'old skill\n')
  writeFileSync(join(stage, 'claudehome', 'projects', 's.jsonl'), '{}\n')
  git(join(stage, 'copy'), 'init', '-q', '-b', 'main')
  git(join(stage, 'copy'), 'add', '-A')
  git(join(stage, 'copy'), 'commit', '-q', '-m', 'first')
  mkdirSync(join(run, 'snap'), { recursive: true })
  mkdirSync(join(run, 'raw'))
  mkdirSync(join(run, 'engine'))
  writeFileSync(join(run, 'engine', 'HEAD'), 'ref\n')
  spawnSync('tar', ['-czf', join(run, 'snap', 'before3.tgz'), '-C', stage, 'copy', 'claudehome'])
  const result = (sid: string) => `{"type":"result","session_id":"${sid}","total_cost_usd":1}\n`
  for (const n of [1, 2, 3]) {
    writeFileSync(join(run, 'raw', `turn${n}.jsonl`), result(`sid-${n}`))
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
  const run = makeRun()
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
    expect(git(join(sample, 'copy'), 'status', '--short').stdout.toString()).toBe('')
    expect(git(join(sample, 'copy'), 'log', '--format=%s').stdout.toString()).toContain('first')
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

  it('names what a run lacks for a replay', () => {
    expect(missingForReplay(run, 2)).toContain('snap/before2.tgz')
  })
})
