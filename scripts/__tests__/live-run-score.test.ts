import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { anchorPresent, NOTES } from '../../examples/live-run/notes.ts'
import { printResults } from '../../examples/live-run/replay.ts'
import { transcriptBlock } from '../../examples/live-run/run-folder.ts'
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

  it('stops with one plain line and the data exit when a rule key is missing or twice in the checklist', () => {
    const real = readFileSync(join(repoRoot(), 'examples/live-run/checklist.md'), 'utf8')
    const dir = mkdtempSync(join(tmpdir(), 'score-keys-'))
    try {
      const say = (checklist: string) => {
        writeFileSync(join(dir, 'checklist.md'), checklist)
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        try {
          return { code: scoreCommand([fixture], undefined, dir), said: err.mock.calls.flat() }
        } finally {
          err.mockRestore()
        }
      }
      const missing = say(real.replace('[turn-count] ', ''))
      expect(missing.code).toBe(EXIT.data)
      expect(missing.said).toEqual(['"turn-count" is not in checklist.md'])
      const twice = say(`${real}\n99. [turn-count] Again.\n`)
      expect(twice.code).toBe(EXIT.data)
      expect(twice.said).toEqual(['"turn-count" is in checklist.md more than once'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a usage fault', () => {
    expect(scoreCommand([])).toBe(EXIT.usage)
    expect(scoreCommand(['a', 'b'])).toBe(EXIT.usage)
  })
})

const turn = (n: number, reply: string) => transcriptBlock(n, 'Yes.', reply)

const draftRaw = (
  id: string,
  file: string,
  out: string,
  { command = `node scripts/profile.ts draft ${file}`, isError = false } = {},
) =>
  [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id,
            name: 'Bash',
            input: { command },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: isError }],
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n')

// Every run folder made here goes when the file ends, so a test that does not remove its own (or
// fails before it can) leaves nothing in the temp directory.
const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const makeRun = (setup: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'score-'))
  made.push(dir)
  setup(dir)
  return dir
}

const updateRun = (reply: string) =>
  makeRun((d) => {
    mkdirSync(join(d, 'written'))
    writeFileSync(join(d, 'written/log.txt'), 'abc Updated the coach\n')
    writeFileSync(join(d, 'transcript.md'), turn(1, reply))
  })

const line26 = (dir: string) => scoreRun(dir).filter((l) => l.startsWith('line 26'))

const onboardingRun = (reply: string) =>
  makeRun((d) => writeFileSync(join(d, 'transcript.md'), turn(1, reply)))

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

  // A file drafted twice with both results good is a false finding, accepted: the scorer cannot tell
  // a replaced summary from one the second call printed nothing for.
  it('marks the first summary of a file drafted twice when both results were good', () => {
    const dir = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      writeFileSync(join(d, 'transcript.md'), turn(1, 'Name: Hannah Pruitt'))
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        `${draftRaw('a', 'profile/identity.yaml', 'Name: Hanna Pruitt')}\n${draftRaw('b', 'profile/identity.yaml', 'Name: Hannah Pruitt')}\n`,
      )
    })
    expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual([
      'line 4 FAIL T1 "Name: Hanna Pruitt"',
    ])
    rmSync(dir, { recursive: true })
  })

  describe('a good summary followed by a call that names the same file again', () => {
    const line4 = (second: { command: string; out: string; isError?: boolean }, reply: string) => {
      const dir = makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
        writeFileSync(
          join(d, 'raw/turn1.jsonl'),
          `${draftRaw('a', 'profile/search.yaml', 'Search city: Leeds')}\n${draftRaw('b', 'x', second.out, { command: second.command, isError: second.isError })}\n`,
        )
      })
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }
    const search = 'node scripts/profile.ts draft profile/search.yaml < a.json'
    const identity = 'node scripts/profile.ts draft profile/identity.yaml < b.json'
    const leeds = ['line 4 FAIL T1 "Search city: Leeds"']

    it('still requires the first summary when a newline-separated command printed only the second file', () => {
      const second = { command: `${search}\necho ----\n${identity}`, out: 'Name: A' }
      expect(line4(second, 'Name: A')).toEqual(leeds)
      expect(line4(second, 'Name: A\nSearch city: Leeds')).toEqual(['line 4 PASS'])
    })

    it('still requires the first summary when a ; chain printed only the second file', () => {
      const second = { command: `${search}; echo ----; ${identity}`, out: 'Name: A' }
      expect(line4(second, 'Name: A')).toEqual(leeds)
    })

    // Limit: other output of a command that exited 0 is not an error result, so the scorer takes
    // its text for a summary line and requires it.
    it('counts the text of other output that exited 0 as a line of its own', () => {
      const second = { command: search, out: 'refused: search.yaml has no city' }
      expect(line4(second, 'Search city: Leeds')).toEqual([
        'line 4 FAIL T1 "refused: search.yaml has no city"',
      ])
    })
  })

  describe('two files drafted in separate calls of one turn', () => {
    const line4 = (reply: string) => {
      const dir = makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
        writeFileSync(
          join(d, 'raw/turn1.jsonl'),
          `${draftRaw('a', 'profile/identity.yaml', 'Name: Hannah Pruitt\nTimezone: Europe/London')}\n${draftRaw('b', 'profile/search.yaml', 'Search city: Leeds')}\n`,
        )
      })
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it('scores no finding when the reply relays both summaries', () => {
      expect(line4('Name: Hannah Pruitt\nTimezone: Europe/London\nSearch city: Leeds')).toEqual([
        'line 4 PASS',
      ])
    })

    it('marks exactly the line the reply left out of the first summary', () => {
      expect(line4('Name: Hannah Pruitt\nSearch city: Leeds')).toEqual([
        'line 4 FAIL T1 "Timezone: Europe/London"',
      ])
    })
  })

  describe('a draft the Draft command refused', () => {
    const refusal =
      'error  cv/master.json: "LinkedIn" still holds the template\'s example; give a value, or null to leave it out'
    const rowsOf = (reply: string, result = `Exit code 1\n${refusal}`) => {
      const dir = makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
        writeFileSync(
          join(d, 'raw/turn1.jsonl'),
          `${draftRaw('a', 'cv/master.json', result, { isError: true })}\n`,
        )
      })
      const rows = scoreRun(dir).filter((l) => /^line (4|5) /.test(l))
      rmSync(dir, { recursive: true })
      return rows
    }

    const reply = 'Thanks. I need a few more things for the CV, one at a time.'

    it('is no draft turn: a reply that does not relay the refusal passes lines 4 and 5', () => {
      expect(rowsOf(reply)).toEqual(['line 4 PASS', 'line 5 PASS'])
    })

    it('is told from a failing command: its first line is still a summary line to relay', () => {
      expect(rowsOf(reply, 'Exit code 1\nboom: cv/master.json failed')).toEqual([
        'line 4 FAIL T1 "boom: cv/master.json failed"',
        'line 5 FAIL T1 "Thanks."',
        'line 5 FAIL T1 "I need a few more things for the CV, one at a time."',
      ])
    })
  })

  describe('an error result of a redraft after a good summary of the same file', () => {
    const line4 = (reply: string) => {
      const dir = makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
        writeFileSync(
          join(d, 'raw/turn1.jsonl'),
          `${draftRaw('a', 'profile/search.yaml', 'Search city: Leeds')}\n${draftRaw('b', 'profile/search.yaml', 'boom: search.yaml failed', { isError: true })}\n`,
        )
      })
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it("still requires the earlier summary, which the user's yes would write", () => {
      expect(line4('boom: search.yaml failed')).toEqual(['line 4 FAIL T1 "Search city: Leeds"'])
      expect(line4('boom: search.yaml failed\nSearch city: Leeds')).toEqual(['line 4 PASS'])
    })

    // Accepted false finding: a reply that drops the error text of a failing command is marked.
    it('marks a reply that relays the earlier summary and not the error text', () => {
      const boom = 'line 4 FAIL T1 "boom: search.yaml failed"'
      expect(line4('Search city: Leeds')).toEqual([boom])
    })

    it('marks every line of both when the reply relays neither', () => {
      expect(line4('Looks fine.')).toEqual([
        'line 4 FAIL T1 "Search city: Leeds"',
        'line 4 FAIL T1 "boom: search.yaml failed"',
      ])
    })
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

  it('scores a run by the kind it names, before it has anything written', () => {
    const named = (kind: string, reply: string) =>
      makeRun((d) => {
        writeFileSync(join(d, 'kind'), `${kind}\n`)
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
      })
    expect(scoreRun(named('update', "I'll load the update steps now."))).toEqual([
      'line 13 FAIL T1 "I\'ll load the update steps now."',
    ])
    expect(scoreRun(named('onboarding', 'Hello.'))).toContain('line 36 INFO 1 turns')
    // A kind file wins over what the folder holds.
    const both = makeRun((d) => {
      writeFileSync(join(d, 'kind'), 'onboarding\n')
      mkdirSync(join(d, 'written'))
      writeFileSync(join(d, 'written/log.txt'), '')
      writeFileSync(join(d, 'transcript.md'), turn(1, 'Hello.'))
    })
    expect(scoreRun(both)).toContain('line 36 INFO 1 turns')
  })
})

describe('the words the scorer marks as a note to itself', () => {
  it('marks "the user" alone and "load the skill" alone, on both run kinds', () => {
    for (const reply of [
      'The user wants this one.',
      'THE USER wants this one.',
      'The user named Anna asked.',
      "Here is the user's plan.",
    ]) {
      expect(scoreRun(updateRun(reply))[0], reply).toMatch(/^line 13 FAIL T1 /)
      expect(line26(onboardingRun(reply))[0], reply).toMatch(/^line 26 FAIL T1 /)
    }
    for (const reply of [
      'Now load the skill.',
      'Now run the skill.',
      'Loading the update skill.',
      'Now running the right skill.',
      'It loads the skill.',
      'It runs the skill.',
      'Load the skills now.',
      'She loaded the skill.',
      'I loaded the skill.',
      'Running the skill next.',
      'I ran the skill.',
      'Loading a skill now.',
    ]) {
      expect(scoreRun(updateRun(reply))[0], reply).toMatch(/^line 13 FAIL T1 /)
      expect(line26(onboardingRun(reply))[0], reply).toMatch(/^line 26 FAIL T1 /)
    }
  })

  it('marks every skill folder by its name, so a new skill must join the scorer', () => {
    const skills = readdirSync(join(repoRoot(), '.claude/skills'), { withFileTypes: true })
    for (const name of skills.filter((e) => e.isDirectory()).map((e) => e.name)) {
      const reply = `We are in the ${name} skill.`
      expect(scoreRun(updateRun(reply))[0], name).toMatch(/^line 13 FAIL T1 /)
      expect(line26(onboardingRun(reply))[0], name).toMatch(/^line 26 FAIL T1 /)
    }
  })

  it('marks a skill by its name, on both run kinds', () => {
    const reply = 'We are in the onboarding skill.'
    expect(scoreRun(updateRun(reply))[0]).toMatch(/^line 13 FAIL T1 /)
    expect(line26(onboardingRun(reply))[0]).toMatch(/^line 26 FAIL T1 /)
  })

  it("leaves the person's own words alone, each as its own sentence, on both run kinds", () => {
    for (const fair of [
      'You said yes.',
      'You asked to update.',
      'Which of your skills should lead?',
      'These are the skills you listed.',
      'Is your user name still the same?',
      'Your username is saved.',
      'Do you run any skills in Python?',
      'I ran a skill-building workshop.',
      'Loading skills onto the team was my job.',
      'Which of the skills you listed should run any skills check?',
      'Is the user-facing app yours?',
      'These are the onboarding skills you listed.',
    ]) {
      expect(scoreRun(updateRun(fair)), fair).toEqual(['line 13 PASS'])
      const out = scoreRun(onboardingRun(fair)).filter((l) => l.startsWith('line 26'))
      expect(out, fair).toEqual(['line 26 PASS'])
    }
  })

  it('does not mark "the user" in a line relayed whole from a summary', () => {
    const dir = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      writeFileSync(
        join(d, 'transcript.md'),
        turn(1, 'Here it is.\n\nNotes: the user prefers mornings'),
      )
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        `${draftRaw('a', 'profile/coach.md', 'Notes: the user prefers mornings')}\n`,
      )
    })
    expect(scoreRun(dir).filter((l) => l.startsWith('line 26'))).toEqual(['line 26 PASS'])
    rmSync(dir, { recursive: true })
  })
})

describe('a write or a drop chained with a draft', () => {
  const run = (command: string, out: string, reply: string) =>
    makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      writeFileSync(join(d, 'transcript.md'), turn(1, reply))
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        `${draftRaw('a', 'profile/search.yaml', out, { command })}\n`,
      )
    })
  const chains = [
    [
      'write',
      'node scripts/profile.ts write profile/identity.yaml && node scripts/profile.ts draft profile/search.yaml',
      'written: profile/identity.yaml',
    ],
    [
      'drop',
      'node scripts/profile.ts drop profile/voice.md && node scripts/profile.ts draft profile/search.yaml',
      'dropped: profile/voice.md',
    ],
  ] as const
  const summary = 'Search city: Leeds\nSearch country: United Kingdom'

  for (const [name, command, own] of chains) {
    it(`does not take the line of a chained ${name} for a line the reply dropped`, () => {
      const dir = run(
        command,
        `${own}\n${summary}`,
        'Here is the setup.\nSearch city: Leeds\nSearch country: United Kingdom\nIs it right?',
      )
      expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual(['line 4 PASS'])
      rmSync(dir, { recursive: true })
    })

    it(`still marks a summary line the reply left out after a chained ${name}`, () => {
      const dir = run(
        command,
        `${own}\n${summary}`,
        'Here is the setup.\nSearch city: Leeds\nIs it right?',
      )
      expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual([
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
      rmSync(dir, { recursive: true })
    })
  }

  describe('an echoed separator between two drafts', () => {
    const command =
      'node scripts/profile.ts draft profile/identity.yaml\necho ----\nnode scripts/profile.ts draft profile/search.yaml'
    const result = 'Name: Hannah Pruitt\n----\n' + summary
    const line4 = (reply: string) => {
      const dir = run(command, result, reply)
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it('scores no finding when the reply relays both summaries', () => {
      expect(line4('Here it is.\nName: Hannah Pruitt\n' + summary + '\nIs it right?')).toEqual([
        'line 4 PASS',
      ])
    })

    const both = (sep: string) =>
      `node scripts/profile.ts draft profile/identity.yaml${sep}node scripts/profile.ts draft profile/search.yaml`
    const relayed = 'Here it is.\nName: Hannah Pruitt\n' + summary + '\nIs it right?'
    const rowsFor = (cmd: string, out: string, reply: string) => {
      const dir = run(cmd, out, reply)
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it('scores a dropped line that an echo also printed when it holds a letter', () => {
      expect(
        rowsFor(both('\necho Done\n'), 'Name: Hannah Pruitt\nDone\n' + summary, relayed),
      ).toEqual(['line 4 FAIL T1 "Done"'])
    })

    it.each([
      ['a quoted echo', both('\necho "----"\n')],
      ['an echo ended by a semicolon on one line', both('; echo ----; ')],
      ['an && chain', both(' && echo ---- && ')],
    ])('scores no finding for the separator of %s', (_name, cmd) => {
      expect(rowsFor(cmd, 'Name: Hannah Pruitt\n----\n' + summary, relayed)).toEqual([
        'line 4 PASS',
      ])
    })

    it('scores the line the reply dropped from the second summary', () => {
      expect(line4('Here it is.\nName: Hannah Pruitt\nSearch city: Leeds\nIs it right?')).toEqual([
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
    })
  })

  it('treats a draft that changed nothing as no summary, whatever was chained before it', () => {
    const dir = run(chains[0][1], `written: profile/identity.yaml\nNo change.`, 'Nothing to show.')
    expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual(['line 4 PASS'])
    rmSync(dir, { recursive: true })
  })

  describe('an earlier summary and a later result that holds only a drop', () => {
    const line4 = (reply: string) => {
      const dir = makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
        writeFileSync(
          join(d, 'raw/turn1.jsonl'),
          `${draftRaw('a', 'profile/search.yaml', summary)}\n${draftRaw(
            'b',
            'profile/search.yaml',
            'dropped: profile/voice.md',
            {
              command: chains[1][1],
            },
          )}\n`,
        )
      })
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it('keeps the earlier summary, so a reply that relays it whole has no finding', () => {
      expect(line4('Search city: Leeds\nSearch country: United Kingdom')).toEqual(['line 4 PASS'])
    })

    it('still marks a line of the earlier summary that the reply left out', () => {
      expect(line4('Search city: Leeds')).toEqual([
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
    })
  })

  describe('a not-written line beside a summary', () => {
    const command =
      'node scripts/profile.ts write profile/identity.yaml; node scripts/profile.ts draft profile/search.yaml'
    const line4 = (reply: string) => {
      const dir = run(
        command,
        `not written: the record check found problems, so profile/identity.yaml stayed as before\n${summary}`,
        reply,
      )
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it('scores no finding when the reply relays the summary whole', () => {
      expect(line4('Search city: Leeds\nSearch country: United Kingdom')).toEqual(['line 4 PASS'])
    })

    it('still marks a summary line the reply left out', () => {
      expect(line4('Search city: Leeds')).toEqual([
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
    })
  })

  describe('a draft whose command fails after it printed the summary', () => {
    const command = 'node scripts/profile.ts draft profile/search.yaml; grep x file'
    const line4 = (reply: string) => {
      const dir = makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), turn(1, reply))
        writeFileSync(
          join(d, 'raw/turn1.jsonl'),
          `${draftRaw('a', 'profile/search.yaml', summary, { command, isError: true })}\n`,
        )
      })
      const rows = scoreRun(dir).filter((l) => l.startsWith('line 4'))
      rmSync(dir, { recursive: true })
      return rows
    }

    it('scores no finding when the reply relays the summary whole', () => {
      expect(line4('Search city: Leeds\nSearch country: United Kingdom')).toEqual(['line 4 PASS'])
    })

    it('marks the one line the reply left out', () => {
      expect(line4('Search city: Leeds')).toEqual([
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
    })

    it('marks every line when the reply drops the summary', () => {
      expect(line4('Looks fine.')).toEqual([
        'line 4 FAIL T1 "Search city: Leeds"',
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
    })
  })

  it('also leaves the line out when the write or drop prints after the draft', () => {
    const dir = run(
      chains[0][1],
      `${summary}\nwritten: profile/identity.yaml`,
      'Search city: Leeds\nSearch country: United Kingdom',
    )
    expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual(['line 4 PASS'])
    rmSync(dir, { recursive: true })
  })
})

describe('the notes a skill asks for beside a summary', () => {
  const framed = (reply: string, withSummary: boolean) =>
    makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      writeFileSync(join(d, 'transcript.md'), turn(1, reply))
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        withSummary ? `${draftRaw('a', 'profile/standard-answers.yaml', 'Answers: three')}\n` : '',
      )
    })
  const line5 = (reply: string, withSummary = true) => {
    const dir = framed(reply, withSummary)
    try {
      return scoreRun(dir).filter((l) => l.startsWith('line 5 '))
    } finally {
      rmSync(dir, { recursive: true })
    }
  }
  const SUMMARY = 'Answers: three'

  it('does not count a left-out career gaps note beside one framing sentence', () => {
    const out = line5(
      `Here is how I'd save it.\n${SUMMARY}\nI've left out the career gaps entry.\nIs it right?`,
    )
    expect(out).toEqual([
      'line 5 PASS',
      'line 5 EXCUSED T1 "I\'ve left out the career gaps entry." by career-gaps-left-out',
    ])
  })

  it('does not count a where-it-went note for a condition on a title', () => {
    const out = line5(
      `Here is how I'd save it.\n${SUMMARY}\nThe small-firm condition went into what a good role has.`,
    )
    expect(out.map((l) => l.split(' ')[2])).toEqual(['PASS', 'EXCUSED'])
    expect(out[1]).toContain('by title-condition-placed-or-left-out')
  })

  it('counts two framing sentences and lists them without the note', () => {
    const out = line5(
      `Here is how I'd save it. Take your time.\n${SUMMARY}\nI've left out the career gaps entry.`,
    )
    expect(out.filter((l) => l.includes('FAIL'))).toEqual([
      'line 5 FAIL T1 "Here is how I\'d save it."',
      'line 5 FAIL T1 "Take your time."',
    ])
    expect(out.some((l) => l.includes('EXCUSED'))).toBe(true)
  })

  it('excuses one sentence per note and counts a second of the same kind', () => {
    const out = line5(
      `Here is how I'd save it.\n${SUMMARY}\nI've left out the career gaps entry. The gaps entry is also left out of the links.`,
    )
    expect(out.filter((l) => l.includes('EXCUSED'))).toHaveLength(1)
    expect(out.filter((l) => l.includes('FAIL'))).toHaveLength(2)
  })

  it('does not excuse a note that names a file or a command', () => {
    const out = line5(
      `Here is how I'd save it.\n${SUMMARY}\nI've left out the career gaps entry from the file.`,
    )
    expect(out.filter((l) => l.includes('FAIL'))).toHaveLength(2)
  })

  it.each([
    "I've left out the career gaps entry because the user has none.",
    "I've left out the career gaps entry, so load the update skill.",
  ])('does not excuse a gaps note that is a note to itself: %s', (note) => {
    const out = line5(`Here is how I'd save it.\n${SUMMARY}\n${note}`)
    expect(out.filter((l) => l.includes('FAIL'))).toHaveLength(2)
    expect(out.some((l) => l.includes('EXCUSED'))).toBe(false)
  })

  it('excuses a preference note and a condition note each by its own entry', () => {
    const out = line5(
      [
        "Here is how I'd save it.",
        SUMMARY,
        'The "rather not" parcel carriers line and the Transport Manager condition both sit under what a good role has, in your words.',
        'Transport Manager stays out of the job titles I search for, because a search can\'t carry a condition like "small firm only".',
      ].join('\n'),
    )
    expect(out[0]).toBe('line 5 PASS')
    expect(out.slice(1)).toHaveLength(2)
    expect(out[1]).toContain('by preference-placed-or-left-out')
    expect(out[2]).toContain('by title-condition-placed-or-left-out')
  })

  it('excuses nothing in a turn that holds no summary', () => {
    const out = line5("I've left out the career gaps entry.", false)
    expect(out.some((l) => l.includes('EXCUSED'))).toBe(false)
  })

  it('scores every entry example as its own excused note, and its non-example as framing', () => {
    for (const e of NOTES) {
      expect(e.matches.test(e.example), e.id).toBe(true)
      const excused = line5(`Here is how I'd save it.\n${SUMMARY}\n${e.example}`).filter((l) =>
        l.includes('EXCUSED'),
      )
      expect(excused, e.id).toHaveLength(1)
      expect(excused[0], e.id).toMatch(new RegExp(` by ${e.id}$`))
      if (e.nonExample === undefined) continue
      const out = line5(`Here is how I'd save it.\n${SUMMARY}\n${e.nonExample}`)
      expect(
        out.some((l) => l.includes('EXCUSED')),
        e.id,
      ).toBe(false)
      expect(
        out.filter((l) => l.includes('FAIL')),
        e.id,
      ).toHaveLength(2)
    }
  })

  const FRAMING = "Here is how I'd save it."
  const ONE_SENTENCE_OVER = [
    "Here are your preferences as they'd go in.",
    "Here is what you'd rather avoid, as it would go in.",
    "Here's the condition list as it would go into your search.",
    'Here are your answers, none of them deal-breakers.',
    "Here is how I'd save your search, with no hard limits changed.",
    "I've left out nothing, and your gaps are covered.",
    'I kept it generic so it reads well.',
    "You'd rather not rush, so take your time going into each one.",
    "Nothing here is a deal-breaker yet, so let's look.",
    'Here is the condition I went with.',
    'Your gaps are not included in this list, which is fine.',
    "I've put together your search preferences as I'd save them.",
    "I've put your answers together below, gaps and all.",
  ]

  it.each(ONE_SENTENCE_OVER)('counts a sentence that only presents or mentions: %s', (s) => {
    const out = line5(`${FRAMING}\n${SUMMARY}\n${s}`)
    expect(out.some((l) => l.includes('EXCUSED'))).toBe(false)
    expect(out.filter((l) => l.includes('FAIL'))).toHaveLength(2)
  })

  describe('a replay of the turn', () => {
    const replayed = (note: string) => {
      const dir = framed(`Here is how I'd save it.\n${SUMMARY}\n${note}`, true)
      writeFileSync(join(dir, 'last.txt'), 'the reply\n')
      const out = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      try {
        printResults(1, [dir], 0.1)
        return out.mock.calls.map((c) => String(c[0])).join('\n')
      } finally {
        out.mockRestore()
        rmSync(dir, { recursive: true })
      }
    }

    it('prints the EXCUSED row of a note and still counts the reply as a pass', () => {
      const printed = replayed("I've left out the career gaps entry.")
      expect(printed).toContain(
        'line 5 EXCUSED T1 "I\'ve left out the career gaps entry." by career-gaps-left-out',
      )
      expect(printed).toContain('line 5: 0 of 1 replies failed (0%)')
    })

    it('prints no EXCUSED row, and counts a fail, for a sentence that is no note', () => {
      const printed = replayed('Take your time going through it.')
      expect(printed).not.toContain('EXCUSED')
      expect(printed).toContain('line 5: 1 of 1 replies failed (100%)')
    })
  })

  describe('two replies of a two-turn run', () => {
    // Reply one fails at turn 1, and at turn 2 both fails and excuses a note; reply two excuses a
    // note at turn 1 and again at turn 2.
    const sample = (turns: [string, string]) =>
      makeRun((d) => {
        mkdirSync(join(d, 'raw'))
        mkdirSync(join(d, 'written'))
        writeFileSync(join(d, 'transcript.md'), `${turn(1, turns[0])}${turn(2, turns[1])}`)
        for (const n of [1, 2])
          writeFileSync(
            join(d, `raw/turn${n}.jsonl`),
            `${draftRaw(`a${n}`, 'profile/standard-answers.yaml', SUMMARY)}\n`,
          )
        writeFileSync(join(d, 'last.txt'), `last of ${d}\n`)
      })
    const GAPS_NOTE = "I've left out the career gaps entry."
    const PREFERENCE_NOTE = 'Your preference for no night shifts sits under what a good role has.'

    it('prints each reply its own rows, and only those of the replayed turn', () => {
      const one = sample([
        `${FRAMING}\n${SUMMARY}\nTake your time.`,
        `${FRAMING}\n${SUMMARY}\nTake your time going through it.\n${GAPS_NOTE}`,
      ])
      const two = sample([
        `${FRAMING}\n${SUMMARY}\n${GAPS_NOTE}`,
        `${FRAMING}\n${SUMMARY}\n${PREFERENCE_NOTE}`,
      ])
      const out = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      let printed: string
      try {
        printResults(2, [one, two], 0.2)
        printed = out.mock.calls.map((c) => String(c[0])).join('\n')
      } finally {
        out.mockRestore()
      }
      const [, first, second] = printed.split(/\n--- reply \d+\n/)
      expect(first?.trim()).toBe(
        `line 5 FAIL T2 "${FRAMING}"\nline 5 FAIL T2 "Take your time going through it."\nline 5 EXCUSED T2 "${GAPS_NOTE}" by career-gaps-left-out\nlast of ${one}`,
      )
      expect(second?.trim()).toBe(
        `line 5 EXCUSED T2 "${PREFERENCE_NOTE}" by preference-placed-or-left-out\nlast of ${two}`,
      )
    })
  })

  it.each([
    [
      'The "rather not" parcel carriers line and the Transport Manager condition both sit under what a good role has, in your words.',
      'preference-placed-or-left-out',
    ],
    [
      'Transport Manager stays out of the job titles I search for, because a search can\'t carry a condition like "small firm only".',
      'title-condition-placed-or-left-out',
    ],
    [
      "I've left out links and the gaps entry, since you have no LinkedIn or GitHub and no gaps to explain.",
      'career-gaps-left-out',
    ],
    ["I've left out links and the gaps entry.", 'career-gaps-left-out'],
  ])('keeps excusing the sentence a past run showed: %s', (s, by) => {
    const out = line5(`${FRAMING}\n${SUMMARY}\n${s}`)
    expect(out.map((l) => l.split(' ')[2])).toEqual(['PASS', 'EXCUSED'])
    expect(out[1]).toMatch(new RegExp(` by ${by}$`))
  })

  it('gives a sentence that fits two entries to the next unused entry', () => {
    const both =
      'The "rather not" parcel carriers line and the Transport Manager condition both sit under what a good role has.'
    const out = line5(`${FRAMING}\n${SUMMARY}\n${both} ${both}`)
    expect(out.map((l) => l.split(' ')[2])).toEqual(['PASS', 'EXCUSED', 'EXCUSED'])
    expect(out[1]).toContain('by preference-placed-or-left-out')
    expect(out[2]).toContain('by title-condition-placed-or-left-out')
  })

  it.each([
    "I've left out the career gaps entry in standard-answers.yaml.",
    "I've left out the career gaps entry from the draft.",
  ])('does not excuse a note that names a path or the draft: %s', (s) => {
    const out = line5(`${FRAMING}\n${SUMMARY}\n${s}`)
    expect(out.some((l) => l.includes('EXCUSED'))).toBe(false)
    expect(out.filter((l) => l.includes('FAIL'))).toHaveLength(2)
  })

  const noteAt = (id: string) => (NOTES.find((e) => e.id === id) as (typeof NOTES)[number]).matches

  // Each row pairs a sentence a guard keeps out with a control that has the same shape without the
  // negation or the pronoun: the guarded sentence is plain framing, its control is the note.
  it.each([
    [
      'career-gaps-left-out',
      'Your gaps are not left out of the list.',
      'Your gaps are left out of the list.',
    ],
    [
      'career-gaps-left-out',
      'Your gaps were never left out of the list.',
      'Your gaps were left out of the list.',
    ],
    [
      'generic-tool-name',
      'It stays generic so it reads well.',
      'The package stays generic so it reads well.',
    ],
  ])('does not take %s: "%s" for a note, though its control is one', (id, guarded, control) => {
    expect(noteAt(id).test(guarded)).toBe(false)
    expect(noteAt(id).test(control)).toBe(true)
  })

  // "Put together" is covered by the sentences above; these two carry the other words the exception
  // names, and each has a control that places the same item with a destination.
  it.each([
    ["I've put your gaps below.", "I've put your gaps under what a good role has."],
    ["I've put your gaps here.", "I've put your gaps under what a good role has."],
  ])('does not take %s for a note, though it names the gaps', (presented, placed) => {
    expect(noteAt('career-gaps-left-out').test(presented)).toBe(false)
    expect(noteAt('career-gaps-left-out').test(placed)).toBe(true)
  })

  it('recognises no entry on plain framing', () => {
    expect(
      NOTES.some((o) => o.matches.test("Here's your standard answers as I'd save them.")),
    ).toBe(false)
  })

  it('points every entry at a line the skill still holds', () => {
    for (const e of NOTES) expect(anchorPresent(e), e.id).toBe(true)
    expect(
      anchorPresent({ ...NOTES[0], anchor: 'a line no skill holds' } as (typeof NOTES)[0]),
    ).toBe(false)
  })
})
