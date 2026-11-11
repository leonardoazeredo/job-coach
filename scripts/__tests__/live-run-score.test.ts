import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scoreCommand, scoreRun } from '../../examples/live-run/score.ts'
import { EXIT } from '../lib/problem.ts'
import { repoRoot } from '../lib/workspace.ts'

// The fixture is a small invented run (the fictional Leeds persona) holding one example of each
// fault the scorer marks, plus a turn that relays its summary whole under one framing sentence.
const fixture = join(repoRoot(), 'examples/live-run/fixture')
const lines = scoreRun(fixture)
const has = (prefix: string, ...parts: string[]) =>
  lines.some((l) => l.startsWith(prefix) && parts.every((p) => l.includes(p)))

describe('the live-run scorer', () => {
  it('marks a note to itself', () => {
    expect(has('line 26 FAIL T15', 'The user said')).toBe(true)
  })

  it('marks every framing sentence around a summary, and a file named', () => {
    expect(lines.filter((l) => l.startsWith('line 5 FAIL T16'))).toHaveLength(3)
    expect(has('line 26 FAIL T16', 'a file')).toBe(true)
  })

  it('marks working words and ordinals', () => {
    expect(has('line 26 FAIL T17', 'draft achievements')).toBe(true)
    expect(has('line 28 FAIL T40', 'first one')).toBe(true)
    expect(has('line 28 FAIL T53', 'seventh one')).toBe(true)
    expect(has('line 28 FAIL T55', 'Last one.')).toBe(true)
  })

  it('marks a summary line that was reworded', () => {
    expect(has('line 4 FAIL T59', 'Title: Transport Planner')).toBe(true)
  })

  it('marks a pronoun in a written file other than coach.md', () => {
    expect(has('line 18 FAIL profile/voice.md', 'She')).toBe(true)
    expect(lines.some((l) => l.includes('coach.md'))).toBe(false)
  })

  it('counts the turns', () => {
    expect(lines).toContain('line 36 INFO 8 turns')
  })

  it('finds nothing in a reply that relays its summary whole under one framing sentence', () => {
    expect(lines.filter((l) => / T18 /.test(l))).toEqual([])
  })

  it('refuses a missing run folder with one plain line and the missing-input code', () => {
    const run = spawnSync(
      process.execPath,
      [join(repoRoot(), 'examples/live-run/score.ts'), join(fixture, 'nowhere')],
      { encoding: 'utf8' },
    )
    expect(run.status).toBe(EXIT.missing)
    expect(run.stdout).toBe('')
    expect(run.stderr.trim().split('\n')).toHaveLength(1)
  })

  it('refuses a usage fault', () => {
    expect(scoreCommand([])).toBe(EXIT.usage)
    expect(scoreCommand(['a', 'b'])).toBe(EXIT.usage)
  })
})
