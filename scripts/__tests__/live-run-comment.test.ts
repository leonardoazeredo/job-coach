import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(text).toContain('`9d686bb`, 9 turns, `$1.42`')
    expect(text).toContain('**Failed, line 26:**\n\n```\nT15, T16, T17\nT15 "The user said')
    expect(text).toContain('T59 "Title: Senior Transport Planner"')
    expect(text).toContain('profile/voice.md:2 "She opens with the point."')
    expect(text).toContain('**Borderline, line 28:**')
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
    expect(text).not.toContain('line 11:**')
  })

  it('posts nothing: the builder never calls gh or the network', () => {
    const source = readFileSync(script, 'utf8')
    expect(source).not.toMatch(/child_process|fetch\(|https?:\/\//)
  })
})

describe('the live-run comment builder, further cases', () => {
  it('carries every verdict line verbatim, passes included, in a text fence', () => {
    build(previous)
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    const report = readFileSync(join(run, 'judge-report.txt'), 'utf8')
    const verdicts = report.split('\n').filter((l) => /^line \d+ (PASS|FAIL|BORDERLINE)/.test(l))
    expect(text).toContain(`**Verdicts:**\n\n\`\`\`text\n${verdicts.join('\n')}\n\`\`\`\n`)
  })

  it('reads its own comment back as the previous verdict', () => {
    const fixed = (text: string) => text.split('\n').find((l) => l.startsWith('Fixed since'))
    const current = readFileSync(join(run, 'judge-report.txt'), 'utf8')
    // Run 1 is the earlier run: its comment, saved, is what run 2 is given.
    cpSync(previous, join(run, 'judge-report.txt'))
    build()
    const saved = join(run, 'saved-comment.md')
    cpSync(join(run, 'comment.md'), saved)
    writeFileSync(join(run, 'judge-report.txt'), current)
    build(previous)
    const fromReport = fixed(readFileSync(join(run, 'comment.md'), 'utf8'))
    build(saved)
    expect(fromReport).toContain('line 11, line 30')
    expect(fixed(readFileSync(join(run, 'comment.md'), 'utf8'))).toBe(fromReport)
  })

  it('puts a quote with markdown, a reference, a mention and a fence inside a longer fence', () => {
    writeFileSync(
      join(run, 'judge-report.txt'),
      [
        'line 26 FAIL T3 @someone #123',
        'line 26 T3 "*x* and #123 and @someone and ```code```"',
      ].join('\n'),
    )
    build()
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    const outside = text
      .split(/^(`{3,}).*\n[\s\S]*?^\1$/m)
      .join('')
      .replace(/^(`{3,}).*$/gm, '')
    expect(outside).not.toMatch(/@someone|#123|\*x\*/)
    expect(text).toContain(
      '````\nT3 @someone #123\nT3 "*x* and #123 and @someone and ```code```"\n````',
    )
  })

  it('names a report with only passes: no failed heading, and the scorer line follows the scorer', () => {
    writeFileSync(join(run, 'judge-report.txt'), 'line 11 PASS\nline 30 PASS\n')
    build()
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    expect(text).not.toMatch(/Failed|Borderline/)
    expect(text).toContain('The scorer marked line 4')
  })

  it('says the scorer marked no line when it finds none', () => {
    writeFileSync(join(run, 'judge-report.txt'), 'line 11 PASS\n')
    writeFileSync(
      join(run, 'transcript.md'),
      '## Turn 1\n\n**Persona:**\n\n> Hi.\n\n**Coach:**\n\n> Hello.\n',
    )
    rmSync(join(run, 'written'), { recursive: true })
    rmSync(join(run, 'raw'), { recursive: true })
    build()
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain('The scorer marked no line.')
  })
})

describe('the live-run comment builder on a judge report that varies its quote lines', () => {
  const report = [
    'line 4 FAIL T59',
    'line 18 FAIL profile/voice.md:17',
    'line 30 FAIL T72',
    'line 11 PASS',
    '',
    'Quotes',
    'line 4 T59 "plain quote"',
    'line 30 T72 FAIL "a verdict word before the quote"',
    'line 18 T61 profile/voice.md:17 "a file and line before the quote"',
    'line 18 T62 coach "has a "quoted" word inside"',
    'line 4 T60 "quote" -> master.json:71 "end": "2011"',
    '   (a note about line 4 that is not a quote line)',
    'Nothing else holds a "quote" without a line number.',
  ].join('\n')

  it('finds each quote under its checklist line, whatever sits before it', () => {
    writeFileSync(join(run, 'judge-report.txt'), report)
    const out = build()
    expect(out.status).toBe(0)
    expect(out.stderr).toBe('')
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    expect(text).toContain(
      '**Failed, line 4:**\n\n```\nT59\nT59 "plain quote"\nT60 "quote" -> master.json:71 "end": "2011"\n```',
    )
    expect(text).toContain(
      '**Failed, line 18:**\n\n```\nprofile/voice.md:17\nT61 profile/voice.md:17 "a file and line before the quote"\nT62 coach "has a "quoted" word inside"\n```',
    )
    expect(text).toContain(
      '**Failed, line 30:**\n\n```\nT72\nT72 FAIL "a verdict word before the quote"\n```',
    )
  })

  it('names a quote line it cannot read on stderr and still writes the comment', () => {
    writeFileSync(
      join(run, 'judge-report.txt'),
      'line 4 FAIL T59\nline 4: "colon after the number"\nline 4 T59 "fine"\n',
    )
    const out = build()
    expect(out.status).toBe(0)
    expect(out.stderr.trim().split('\n')).toEqual([
      'judge-report.txt:2: not read as a quote: line 4: "colon after the number"',
    ])
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain('T59 "fine"')
  })
})

describe('the live-run comment builder, cost and round trips', () => {
  it('prints the cost to two decimals', () => {
    writeFileSync(join(run, 'cost.txt'), 'total_usd 1.2699870999999996\n')
    build(previous)
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain('`$1.27`')
  })

  it('shows a verdict line that holds a quote once, under one heading', () => {
    writeFileSync(
      join(run, 'judge-report.txt'),
      'line 26 BORDERLINE config/x.yaml:1 "# hi"\nline 26 T3 "another"\n',
    )
    build()
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    expect(text).toContain(
      '**Borderline, line 26:**\n\n```\nconfig/x.yaml:1 "# hi"\nT3 "another"\n```',
    )
    expect(text.match(/Borderline, line 26/g)).toHaveLength(1)
    expect(text.match(/config\/x\.yaml:1 "# hi"/g)).toHaveLength(2) // the section and the verdict block
  })

  it('prints a cost that is not a number as read', () => {
    writeFileSync(join(run, 'cost.txt'), 'total_usd n/a\n')
    build()
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain('`n/a`')
  })

  it('reads a comment built from the new quote shapes as the previous verdict', () => {
    writeFileSync(
      join(run, 'judge-report.txt'),
      'line 18 FAIL profile/voice.md:17\nline 30 FAIL T72\nline 18 T61 profile/voice.md:17 "q"\nline 30 T72 FAIL "q"\n',
    )
    build()
    const saved = join(run, 'saved.md')
    cpSync(join(run, 'comment.md'), saved)
    writeFileSync(join(run, 'judge-report.txt'), 'line 18 PASS\nline 30 FAIL T80\n')
    build(saved)
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain(
      'Fixed since the previous run: line 18.',
    )
  })

  it('reads a comment built before this change as a previous verdict', () => {
    const old = join(run, 'old-comment.md')
    writeFileSync(
      old,
      'Live run at commit `abc`, 3 turns, `$1.2699870999999996`, judged.\n\n**Failed, line 4:**\n\n```\nT59\nT59 "x"\n```\n\n**Verdicts:**\n\n```text\nline 4 FAIL T59\n```\n',
    )
    writeFileSync(join(run, 'judge-report.txt'), 'line 4 PASS\n')
    build(old)
    expect(readFileSync(join(run, 'comment.md'), 'utf8')).toContain(
      'Fixed since the previous run: line 4.',
    )
  })
})

describe('the live-run comment builder on a saved history', () => {
  it('reads only the last verdict block of a file holding several saved comments', () => {
    const block = (lines: string[]) => `**Verdicts:**\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\`\n`
    const history = join(run, 'history.md')
    writeFileSync(
      history,
      `${block(['line 4 FAIL T2', 'line 11 PASS'])}\n${block(['line 4 PASS', 'line 11 FAIL T9'])}`,
    )
    writeFileSync(join(run, 'judge-report.txt'), 'line 4 PASS\nline 11 PASS\n')
    build(history)
    const text = readFileSync(join(run, 'comment.md'), 'utf8')
    expect(text).toContain('Fixed since the previous run: line 11.\n')
  })
})

describe('the live-run comment builder on input it cannot use', () => {
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

  it('refuses a report with no verdict line, writing no comment', () => {
    writeFileSync(join(run, 'judge-report.txt'), 'Line 26: FAIL T15\n')
    const out = build()
    expect(out.status).toBe(EXIT.data)
    expect(out.stderr.trim().split('\n')).toHaveLength(1)
    expect(out.stderr).toContain('no `line N PASS|FAIL|BORDERLINE|SKIPPED` lines')
    expect(existsSync(join(run, 'comment.md'))).toBe(false)
  })

  it('refuses a previous verdict that is missing or holds no verdict line', () => {
    const missing = build(join(run, 'nowhere.txt'))
    expect(missing.status).toBe(EXIT.missing)
    expect(missing.stderr.trim().split('\n')).toHaveLength(1)
    writeFileSync(join(run, 'empty.txt'), 'nothing here\n')
    expect(build(join(run, 'empty.txt')).status).toBe(EXIT.data)
  })

  it('refuses a run folder that is absent or is a file, with one line', () => {
    for (const bad of [join(run, 'nowhere'), join(run, 'cost.txt')]) {
      const out = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' })
      expect(out.status).toBe(EXIT.missing)
      expect(out.stderr.trim().split('\n')).toHaveLength(1)
    }
  })

  it('names every missing file in one line', () => {
    for (const f of ['judge-report.txt', 'commit.txt', 'cost.txt']) rmSync(join(run, f))
    const out = build()
    expect(out.status).toBe(EXIT.missing)
    expect(out.stderr.trim().split('\n')).toHaveLength(1)
    for (const f of ['judge-report.txt', 'commit.txt', 'cost.txt']) expect(out.stderr).toContain(f)
  })
})
