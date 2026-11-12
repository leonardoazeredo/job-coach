import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scoreCommand, scoreRun } from '../../examples/live-run/score.ts'
import { EXIT } from '../lib/problem.ts'
import { repoRoot } from '../lib/workspace.ts'

// The fixture is a small invented onboarding run (the fictional Leeds persona) holding the faults
// of lines 4, 5, 18, 26 and 28, plus a turn that relays its summary whole under one framing
// sentence. The update-run line is built in a temporary folder further down.
const fixture = join(repoRoot(), 'examples/live-run/fixture')
const lines = scoreRun(fixture)
const has = (prefix: string, ...parts: string[]) =>
  lines.some((l) => l.startsWith(prefix) && parts.every((p) => l.includes(p)))

describe('the live-run scorer', () => {
  it('marks a note to itself', () => {
    expect(has('line 26 FAIL T15', 'The user said')).toBe(true)
  })

  it('marks a note to itself that names the person as "the user" and a skill to load', () => {
    expect(has('line 26 FAIL T60', 'The user already asked to update, so load the skill')).toBe(
      true,
    )
  })

  it('marks every framing sentence around a summary, and a file named', () => {
    expect(lines.filter((l) => l.startsWith('line 5 FAIL T16'))).toHaveLength(3)
    expect(has('line 26 FAIL T16', 'a file')).toBe(true)
  })

  it('marks working words and ordinals', () => {
    expect(has('line 26 FAIL T17', 'draft achievements')).toBe(true)
    expect(has('line 28 FAIL T40', 'first one')).toBe(true)
    expect(has('line 28 FAIL T40', 'last achievement')).toBe(true)
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
    expect(lines).toContain('line 36 INFO 9 turns')
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

const turn = (n: number, reply: string) =>
  `## Turn ${n}\n\n**Persona:**\n\n> Yes.\n\n**Coach:**\n\n${reply
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')}\n\n`

const draftRaw = (id: string, file: string, out: string) =>
  [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id,
            name: 'Bash',
            input: { command: `node scripts/profile.ts draft ${file}` },
          },
        ],
      },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n')

const makeRun = (setup: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'score-'))
  setup(dir)
  return dir
}

describe('what the scorer will not call a pass or a fault', () => {
  it('leaves a shipped pack copy alone and still reads a changed one', () => {
    const shipped = readFileSync(join(repoRoot(), 'config/competencies/frontend.yaml'), 'utf8')
    expect(/\b(he|she|his|her|they|their|them)\b/i.test(shipped)).toBe(true)
    const dir = makeRun((d) => {
      writeFileSync(join(d, 'transcript.md'), turn(1, 'Hello.'))
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written/config/competencies'), { recursive: true })
      writeFileSync(join(d, 'written/config/competencies/frontend.yaml'), shipped)
      writeFileSync(join(d, 'written/config/competencies/mine.yaml'), 'note: she leads\n')
    })
    const out = scoreRun(dir)
    expect(out.some((l) => l.includes('frontend.yaml'))).toBe(false)
    expect(out.some((l) => l.startsWith('line 18 FAIL config/competencies/mine.yaml'))).toBe(true)
    rmSync(dir, { recursive: true })
  })

  it('skips lines whose evidence folder is missing', () => {
    const dir = makeRun((d) => writeFileSync(join(d, 'transcript.md'), turn(1, 'Hello.')))
    const out = scoreRun(dir)
    expect(out).toContain('line 4 SKIPPED no raw/ folder')
    expect(out).toContain('line 5 SKIPPED no raw/ folder')
    expect(out).toContain('line 18 SKIPPED no written/ folder')
    expect(out.some((l) => l.startsWith('line 4 PASS'))).toBe(false)
    rmSync(dir, { recursive: true })
  })

  it('keeps only the last summary of a file drafted twice in a turn', () => {
    const dir = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      writeFileSync(join(d, 'transcript.md'), turn(1, 'Name: Hannah Pruitt'))
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        `${draftRaw('a', 'profile/identity.yaml', 'Name: Hanna Pruitt')}\n${draftRaw('b', 'profile/identity.yaml', 'Name: Hannah Pruitt')}\n`,
      )
    })
    expect(scoreRun(dir)).toContain('line 4 PASS')
    rmSync(dir, { recursive: true })
  })

  it('scores an update run on line 13 only', () => {
    const update = (reply: string) =>
      makeRun((d) => {
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'written/log.txt'), 'abc Updated the coach\n')
        writeFileSync(
          join(d, 'transcript.md'),
          turn(1, 'The new version is ready.') + turn(2, reply),
        )
      })
    const bad = scoreRun(update("I'll load the update steps now."))
    expect(bad.some((l) => l.startsWith('line 13 FAIL T2'))).toBe(true)
    expect(bad.some((l) => l.startsWith('line 36'))).toBe(false)
    expect(scoreRun(update('The coach is updated.'))).toEqual(['line 13 PASS'])
  })

  it("marks the same note to itself on an update run, and leaves the person's own words alone", () => {
    const update = (reply: string) =>
      makeRun((d) => {
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'written/log.txt'), 'abc Updated the coach\n')
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
      })
    expect(scoreRun(update('the user already asked to update, so load the skill.'))[0]).toMatch(
      /^line 13 FAIL T1 /,
    )
    expect(scoreRun(update('Running the update-coach skill now.'))[0]).toMatch(/^line 13 FAIL/)
    for (const fair of [
      'You said yes.',
      'You asked to update.',
      'Which of your skills should lead?',
      'These are the skills you listed.',
      'Is your user name still the same?',
      'Your username is saved.',
    ]) {
      expect(scoreRun(update(fair)), fair).toEqual(['line 13 PASS'])
    }
  })

  it('leaves the same fair words alone on an onboarding run', () => {
    const dir = makeRun((d) => {
      const fair =
        'You said yes. You asked for more. Which of your skills lead? These are the skills you listed. Is your user name right?'
      writeFileSync(join(d, 'transcript.md'), turn(1, fair))
    })
    expect(scoreRun(dir).filter((l) => l.startsWith('line 26'))).toEqual(['line 26 PASS'])
    rmSync(dir, { recursive: true })
  })
})
