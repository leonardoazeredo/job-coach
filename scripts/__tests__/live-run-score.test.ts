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
  command = `node scripts/profile.ts draft ${file}`,
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
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] },
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
        `${draftRaw('a', 'profile/search.yaml', out, command)}\n`,
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

  it('treats a draft that changed nothing as no summary, whatever was chained before it', () => {
    const dir = run(chains[0][1], `written: profile/identity.yaml\nNo change.`, 'Nothing to show.')
    expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual(['line 4 PASS'])
    rmSync(dir, { recursive: true })
  })

  it('keeps the earlier summary of a file when a later chained result holds no draft line', () => {
    const dir = makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      writeFileSync(join(d, 'transcript.md'), turn(1, 'Search city: Leeds'))
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        `${draftRaw('a', 'profile/search.yaml', 'Search city: Leeds')}\n${draftRaw('b', 'profile/search.yaml', 'dropped: profile/voice.md', chains[1][1])}\n`,
      )
    })
    expect(scoreRun(dir).filter((l) => l.startsWith('line 4'))).toEqual(['line 4 PASS'])
    rmSync(dir, { recursive: true })
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

describe('one command that drafts two files', () => {
  const draft = (f: string) => 'node scripts/profile.ts draft ' + f + ' <<\'EOF\'\n{"a":1}\nEOF'
  const first = 'Name: Hannah Pruitt'
  const second = 'Search city: Leeds\nSearch country: United Kingdom'
  const run = (command: string, out: string, reply: string, copy?: [string, string]) =>
    makeRun((d) => {
      mkdirSync(join(d, 'raw'))
      mkdirSync(join(d, 'written'))
      if (copy) {
        mkdirSync(join(d, 'copy/templates'), { recursive: true })
        writeFileSync(join(d, 'copy', copy[0]), copy[1])
      }
      writeFileSync(join(d, 'transcript.md'), turn(1, reply))
      writeFileSync(
        join(d, 'raw/turn1.jsonl'),
        draftRaw('a', 'profile/identity.yaml', out, command),
      )
    })
  const line4 = (dir: string) => {
    const out = scoreRun(dir).filter((l) => l.startsWith('line 4'))
    rmSync(dir, { recursive: true })
    return out
  }
  const whole = 'Here is the setup.\n' + first + '\n' + second + '\nIs it right?'
  const short = 'Here is the setup.\n' + first + '\nSearch city: Leeds\nIs it right?'

  const shapes: [string, string, string, [string, string]?][] = [
    [
      'an echo between them',
      draft('profile/identity.yaml') + '\necho ----; ' + draft('profile/search.yaml'),
      first + '\n----\n' + second,
    ],
    [
      'a cat between them',
      draft('profile/identity.yaml') + '\ncat templates/note.md\n' + draft('profile/search.yaml'),
      first + '\nNote line one\nNote line two\n' + second,
      ['templates/note.md', 'Note line one\nNote line two\n'],
    ],
    [
      'a cat after them',
      draft('profile/identity.yaml') +
        '\n' +
        draft('profile/search.yaml') +
        '\ncat templates/note.md',
      first + '\n' + second + '\nNote line one\nNote line two',
      ['templates/note.md', 'Note line one\nNote line two\n'],
    ],
  ]

  for (const [name, command, out, copy] of shapes) {
    it('scores no finding with ' + name + ' when the reply relays both summaries whole', () => {
      expect(line4(run(command, out, whole, copy))).toEqual(['line 4 PASS'])
    })

    it('scores exactly the dropped line with ' + name, () => {
      expect(line4(run(command, out, short, copy))).toEqual([
        'line 4 FAIL T1 "Search country: United Kingdom"',
      ])
    })
  }

  it('still counts a command output it cannot read as part of the summaries', () => {
    const dir = run(
      draft('profile/identity.yaml') + '\ncat templates/missing.md',
      first + '\nMissing line',
      first,
    )
    expect(line4(dir)).toEqual(['line 4 FAIL T1 "Missing line"'])
  })
})
