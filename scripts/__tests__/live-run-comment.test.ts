import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commentCommand } from '../../examples/live-run/comment.ts'
import { EXIT } from '../lib/problem.ts'
import { repoRoot } from '../lib/workspace.ts'

// The fixture run folder is copied first: the builder writes comment.md into the folder it is
// given, and the checked-in fixture must stay as it is.
const fixture = join(repoRoot(), 'examples/live-run/fixture')
const script = join(repoRoot(), 'examples/live-run/comment.ts')
const previous = join(fixture, 'previous-judge-report.txt')

let run: string
beforeEach(() => {
  run = mkdtempSync(join(tmpdir(), 'comment-'))
  cpSync(fixture, run, { recursive: true })
})
afterEach(() => rmSync(run, { recursive: true }))

const build = (...args: string[]) =>
  spawnSync(process.execPath, [script, run, ...args], { encoding: 'utf8' })

describe('the live-run comment builder', () => {
  it('writes the commit, turns, cost and each failed line with its turn and quote', () => {
    const out = build(previous)
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe(join(run, 'comment.md'))
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    expect(text).toContain('`9d686bb`, 8 turns, $1.4213')
    expect(text).toContain('- Line 26, T15, T16, T17')
    expect(text).toContain('T15 "The user said \\"none\\" for the start, so null is theirs."')
    expect(text).toContain('T59 "Title: Senior Transport Planner"')
    expect(text).toContain('profile/voice.md:2 "She opens with the point."')
    expect(text).toMatch(/\*\*Borderline:\*\*\n- Line 28/)
    expect(text).toContain('The scorer marked line 4, line 5, line 18, line 26, line 28')
  })

  it('names the lines fixed since the previous run, and says so when none was given', () => {
    build(previous)
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain(
      'Fixed since the previous run: line 11, line 30.',
    )
    build()
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain(
      'No previous verdict was given, so no lines are compared.',
    )
  })

  it('carries no attribution line and no passing line', () => {
    build(previous)
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    expect(text).not.toMatch(/Co-Authored|Generated with|claude\.ai/i)
    expect(text).not.toContain('Line 11,')
  })

  it('ends a run with no judge report in one plain line and the missing-input code', () => {
    rmSync(join(run, 'judge-report.txt'))
    const out = build()
    expect(out.status).toBe(EXIT.missing)
    expect(out.stdout).toBe('')
    expect(out.stderr.trim().split('\n')).toHaveLength(1)
    expect(out.stderr).toContain('judge-report.txt')
    expect(existsSync(join(run, 'comment.md'))).toBe(false)
  })

  it('refuses a usage fault', () => {
    expect(commentCommand([])).toBe(EXIT.usage)
    expect(commentCommand(['a', 'b', 'c'])).toBe(EXIT.usage)
    expect(commentCommand(['--post'])).toBe(EXIT.usage)
  })

  it('posts nothing: the builder never calls gh or the network', () => {
    const source = readFileSync(script, 'utf8')
    expect(source).not.toMatch(/child_process|fetch\(|https?:\/\//)
  })
})
