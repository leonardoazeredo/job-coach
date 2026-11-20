import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { failedAt, failedLines, formatRow, type Row } from '../../examples/live-run/findings.ts'
import { transcriptBlock } from '../../examples/live-run/run-folder.ts'
import {
  CHECKLIST_FILE,
  checklistLines,
  RULES,
  scoreFindings,
  scoreRun,
} from '../../examples/live-run/score.ts'
import { repoRoot } from '../lib/workspace.ts'

const checklistDir = join(repoRoot(), 'examples/live-run')
const fixture = join(checklistDir, 'fixture')
const tmp = mkdtempSync(join(tmpdir(), 'findings-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
let count = 0
const makeRun = (setup: (dir: string) => void) => {
  const dir = join(tmp, `r${count++}`)
  mkdirSync(dir)
  setup(dir)
  return dir
}
const oneTurn = (dir: string) =>
  writeFileSync(join(dir, 'transcript.md'), transcriptBlock(1, 'Yes.', 'Hello.'))

describe('the printed text of a finding', () => {
  it('is the line, the verdict, the place and the quoted text, as the judge reads it', () => {
    const rows: [Row, string][] = [
      [
        { line: 26, status: 'FAIL', turn: 15, text: 'The user said "none".' },
        'line 26 FAIL T15 "The user said "none"."',
      ],
      [
        { line: 18, status: 'FAIL', where: 'profile/voice.md:3', text: 'She signs off.' },
        'line 18 FAIL profile/voice.md:3 "She signs off."',
      ],
      [{ line: 4, status: 'PASS' }, 'line 4 PASS'],
      [{ line: 28, status: 'SKIPPED', text: 'no raw/ folder' }, 'line 28 SKIPPED no raw/ folder'],
      [{ line: 36, status: 'INFO', text: '9 turns' }, 'line 36 INFO 9 turns'],
    ]
    for (const [row, text] of rows) expect(formatRow(row)).toBe(text)
  })
})

describe('what counts as a failure', () => {
  const rows: Row[] = [
    { line: 4, status: 'FAIL', turn: 2, text: 'a' },
    { line: 4, status: 'FAIL', turn: 9, text: 'b' },
    { line: 18, status: 'FAIL', where: 'profile/voice.md:3', text: 'c' },
    { line: 5, status: 'PASS' },
    { line: 36, status: 'INFO', text: '9 turns' },
  ]

  it('is a FAIL row; at a turn only when it names that turn', () => {
    expect(failedAt(rows, 2).map((r) => r.text)).toEqual(['a'])
    expect(failedAt(rows, 9).map((r) => r.text)).toEqual(['b'])
    expect(failedAt(rows, 3)).toEqual([])
  })

  it('lists each line that failed once, a written file included', () => {
    expect(failedLines(rows)).toEqual([4, 18])
    expect(failedLines([{ line: 5, status: 'PASS' }])).toEqual([])
  })
})

describe('what the scorer prints', () => {
  // Literal text: the judge reads these lines and saved score files hold them, so a change to the
  // wording or the order of any must be deliberate.
  it('is, for the fixture run, exactly what it was', () => {
    expect(scoreRun(fixture)).toEqual([
      'line 4 FAIL T59 "Title: Transport Planner"',
      'line 5 FAIL T16 "Here are your achievements, so there\'s a file to work from."',
      'line 5 FAIL T16 "None counts as approved yet."',
      'line 5 FAIL T16 "We\'ll go through them one by one later."',
      'line 18 FAIL profile/voice.md:3 "Hannah writes short, plain sentences. She opens with the point."',
      'line 18 FAIL profile/voice.md:4 "She signs off with her first name only."',
      'line 26 FAIL T15 "The user said "none" for the start, so null is theirs."',
      'line 26 FAIL T16 "Here are your achievements, so there\'s a file to work from."',
      'line 26 FAIL T17 "I\'ve put together the draft achievements for you to look at."',
      'line 26 FAIL T60 "The user already asked to update, so load the skill."',
      'line 28 FAIL T40 "Now the first one on the list."',
      'line 28 FAIL T40 "Your last achievement comes after that."',
      'line 28 FAIL T53 "Next is the seventh one."',
      'line 28 FAIL T55 "Last one."',
      'line 36 INFO 9 turns',
    ])
  })

  it('is one PASS row per rule on a run with no finding, and a SKIPPED row where evidence is missing', () => {
    const bare = makeRun(oneTurn)
    expect(scoreRun(bare)).toEqual([
      'line 4 SKIPPED no raw/ folder',
      'line 5 SKIPPED no raw/ folder',
      'line 18 SKIPPED no written/ folder',
      'line 26 PASS',
      'line 28 SKIPPED no raw/ folder',
      'line 36 INFO 1 turns',
    ])
    const full = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      oneTurn(d)
    })
    expect(scoreRun(full)).toEqual([
      'line 4 PASS',
      'line 5 PASS',
      'line 18 PASS',
      'line 26 PASS',
      'line 28 PASS',
      'line 36 INFO 1 turns',
    ])
    const update = makeRun((d) => {
      writeFileSync(join(d, 'kind'), 'update\n')
      oneTurn(d)
    })
    expect(scoreRun(update)).toEqual(['line 13 PASS'])
  })
})

describe('the order of the rows', () => {
  it('is by line, then by turn, whatever order the transcript holds its turns in', () => {
    const run = makeRun((d) =>
      writeFileSync(
        join(d, 'transcript.md'),
        transcriptBlock(5, 'Yes.', 'The user said no.') +
          transcriptBlock(2, 'Yes.', 'The user said yes.'),
      ),
    )
    expect(scoreRun(run).filter((l) => l.startsWith('line 26'))).toEqual([
      'line 26 FAIL T2 "The user said yes."',
      'line 26 FAIL T5 "The user said no."',
    ])
  })
})

describe('the rules', () => {
  it('find every key exactly once in the checklist of each kind of run they apply to', () => {
    const keys = RULES.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of RULES) {
      for (const kind of r.runs) {
        const text = readFileSync(join(checklistDir, CHECKLIST_FILE[kind]), 'utf8')
        const found = text
          .split('\n')
          .filter((l) => l.match(/^\d+\.\s+\[([^\]]+)\]/)?.[1] === r.key)
        expect(found, `${r.key} in ${CHECKLIST_FILE[kind]}`).toHaveLength(1)
      }
    }
  })

  it('give every declared line a row on a run with no finding, and no row for an undeclared line', () => {
    const full = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      oneTurn(d)
    })
    const onboarding = RULES.filter((r) => r.runs.includes('onboarding'))
    const at = checklistLines('onboarding', onboarding)
    const declared = onboarding.map((r) => at.get(r.key) as number)
    const rows = scoreFindings(full)
    expect(rows.map((r) => r.line).sort((a, b) => a - b)).toEqual(
      [...declared].sort((a, b) => a - b),
    )
    for (const r of rows) expect(['PASS', 'INFO']).toContain(r.status)
  })

  it('never report a line no rule declares, even on a run full of findings', () => {
    const declared = new Set(
      (['onboarding', 'update'] as const).flatMap((k) => [...checklistLines(k).values()]),
    )
    for (const r of scoreFindings(fixture)) expect(declared.has(r.line), formatRow(r)).toBe(true)
  })

  it('give a rule added to the table its PASS row without any other edit', () => {
    const extra = {
      key: 'extra-rule',
      runs: ['onboarding' as const],
      find: () => [],
    }
    const full = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      oneTurn(d)
    })
    const dir = makeRun((d) =>
      writeFileSync(
        join(d, 'checklist.md'),
        `${readFileSync(join(checklistDir, 'checklist.md'), 'utf8')}\n99. [extra-rule] Anything.\n`,
      ),
    )
    expect(scoreFindings(full, [...RULES, extra], dir).map(formatRow)).toContain('line 99 PASS')
    const failing = { ...extra, find: () => [{ turn: 1, text: 'zzz happened.' }] }
    expect(scoreFindings(full, [...RULES, failing], dir).map(formatRow)).toContain(
      'line 99 FAIL T1 "zzz happened."',
    )
  })
})
