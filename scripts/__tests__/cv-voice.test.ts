import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, voiceFindings } from '../lib/cv-voice.ts'
import { openWorkspace } from '../lib/workspace.ts'
import { variant } from './fixtures.ts'
import {
  degree,
  editMaster,
  errorsFor,
  larkspur,
  masterTech,
  messages,
  repo,
  roleProblems,
  warningsFor,
  withBullet,
} from './role-cv-helpers.ts'

const DOCK_FIGURE = 'monthly AWS bill for label printing down from $9,400 to $3,100'
const setFigure = (metric: string) =>
  repo.editYaml<{ wins: { slug: string; metric: string }[] }>('profile/wins.yaml', (file) => {
    const win = file.wins.find((w) => w.slug === 'bw-aws-cost')
    if (win) win.metric = metric
  })
const costBullet = (metric: string) =>
  withBullet('brightwell', `Moved label printing to Lambda; ${metric}.`, ['win:bw-aws-cost'])

describe('words that do not belong on a CV', () => {
  it.each([
    'Built the I/O layer for the CI/CD pipeline.',
    'IT support for the other team (React, TypeScript).',
    'Moved to i18n and the iPhone app.',
    'Portland, ME, United States',
    'BEng ME',
    'Treated HER2 results (HIS data)',
  ])('trips nothing on "%s"', (text) => {
    expect(voiceFindings(text, DEFAULT_VOICE)).toEqual([])
  })

  it('reports a capital I on its own, any case of the other words, and a bracketed note once', () => {
    expect(
      voiceFindings('I built it. His team.', DEFAULT_VOICE)
        .map((f) => f.phrase)
        .sort(),
    ).toEqual(['His', 'I'])
    expect(voiceFindings('down 20% (his estimate)', DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: '(his estimate)' },
    ])
    expect(voiceFindings('i built it', DEFAULT_VOICE)).toEqual([])
  })

  it('still refuses "me" and "Me", and a capitalised note in brackets', () => {
    expect(voiceFindings('told me', DEFAULT_VOICE)).toEqual([{ level: 'error', phrase: 'me' }])
    expect(voiceFindings('Me and the team', DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: 'Me' },
    ])
    expect(voiceFindings('down 20% (TBC)', DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: '(TBC)' },
    ])
  })

  it("refuses I'm and I'd as first-person words", () => {
    expect(voiceFindings("I'm in charge. I'd lead.", DEFAULT_VOICE).map((f) => f.phrase)).toEqual([
      'I',
    ])
  })

  it.each(['(estimated)', '(approximately)', '[estimates]'])('refuses the note %s', (note) => {
    expect(voiceFindings(`down 20% ${note}`, DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: note },
    ])
  })

  it.each(['(React, TypeScript)', '(Series B)', '(Python 3)'])('passes the bracket %s', (text) => {
    expect(voiceFindings(`Built it ${text}`, DEFAULT_VOICE)).toEqual([])
  })

  it('reports both words of he/she', () => {
    expect(voiceFindings('he/she ships', DEFAULT_VOICE).map((f) => f.phrase)).toEqual(['he', 'she'])
  })

  it('refuses a square-bracketed note, and a round one holding a note word', () => {
    expect(voiceFindings('down 20% [approx.]', DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: '[approx.]' },
    ])
    expect(voiceFindings('down 20% (see note)', DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: '(see note)' },
    ])
  })
})

describe('the voice check on a quoted figure', () => {
  it('refuses a note in a figure and blames the achievement figure', () => {
    setFigure(`${DOCK_FIGURE} (his estimate)`)
    const found = errorsFor(costBullet(`${DOCK_FIGURE} (his estimate)`))
    expect(found).toEqual([expect.stringContaining('"(his estimate)"')])
    expect(found[0]).toContain("achievement's figure needs rewording")
    expect(found[0]).toContain('brightwell bullet 1')
  })

  it('refuses a pronoun in a figure and blames the achievement figure', () => {
    setFigure(`${DOCK_FIGURE} by my team`)
    const found = errorsFor(costBullet(`${DOCK_FIGURE} by my team`))
    expect(found).toEqual([expect.stringContaining('"my"')])
    expect(found[0]).toContain("achievement's figure needs rewording")
  })

  it('attributes an offender in a second clause when the bullet quotes that clause whole', () => {
    const second = 'the on-call load dropped to 2 pages (my estimate)'
    setFigure(`${DOCK_FIGURE}; ${second}`)
    const found = errorsFor(
      withBullet('brightwell', `Moved label printing to Lambda, and ${second}.`, [
        'win:bw-aws-cost',
      ]),
    )
    expect(found).toEqual([expect.stringContaining('"(my estimate)"')])
    expect(found[0]).toContain("achievement's figure needs rewording")
  })

  it('passes the same CV with the wording fixed', () => {
    setFigure(DOCK_FIGURE)
    expect(errorsFor(costBullet(DOCK_FIGURE))).toEqual([])
  })
})

describe('the voice check on bullets', () => {
  const twoBullets = () => {
    const v = costBullet(DOCK_FIGURE)
    const job = v.jobs.find((j) => j.id === 'brightwell')
    if (!job) throw new Error('no job')
    job.bullets = [
      { text: 'He moved label printing to Lambda.', sources: ['win:bw-aws-cost'], answers: [] },
      {
        text: `Moved printing; his team saw ${DOCK_FIGURE}.`,
        sources: ['win:bw-aws-cost'],
        answers: [],
      },
    ]
    return v
  }

  it('names each bullet holding a pronoun, once each', () => {
    const found = errorsFor(twoBullets())
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('"He"')
    expect(found[0]).toContain('brightwell bullet 1')
    expect(found[1]).toContain('"his"')
    expect(found[1]).toContain('brightwell bullet 2')
  })

  it('does not blame the figure for a pronoun outside it', () => {
    expect(errorsFor(twoBullets())[1]).not.toContain('figure needs rewording')
  })

  it('warns on "their" without refusing', () => {
    const v = withBullet('brightwell', 'Moved their label printing to Lambda.', ['win:bw-aws-cost'])
    expect(errorsFor(v)).toEqual([])
    expect(warningsFor(v)).toEqual(expect.arrayContaining([expect.stringContaining('"their"')]))
  })
})

describe('the voice check on text no bullet covers', () => {
  const voiceErrorsAt = () =>
    messages(roleProblems(), 'error').filter((m) => /has the (pronoun|bracketed note)/.test(m))

  it('refuses a pronoun in the headline', () => {
    larkspur.writeVariant((v) => {
      v.headline = 'Backend engineer who builds what she ships'
    })
    expect(voiceErrorsAt()).toEqual([expect.stringContaining('cv headline: has the pronoun "she"')])
  })

  it('refuses a pronoun in a skill', () => {
    larkspur.writeVariant((v) => {
      v.skills = ['Python', 'what she knows']
    })
    expect(voiceErrorsAt()).toEqual([expect.stringContaining('cv skills: ')])
  })

  it('refuses a note in a training line', () => {
    editMaster((m) => {
      m.training = ['Safety course (todo)']
    })
    expect(voiceErrorsAt()).toEqual([
      expect.stringContaining('cv training: has the bracketed note "(todo)"'),
    ])
  })

  it('refuses a pronoun in a language line', () => {
    editMaster((m) => {
      m.languages = ['English (my first)']
    })
    expect(voiceErrorsAt()).toEqual([expect.stringContaining('cv languages: ')])
  })

  it('refuses a note in an education line', () => {
    editMaster((m) => {
      m.education = [degree('BSc (todo)')]
    })
    expect(voiceErrorsAt()).toEqual([expect.stringContaining('cv education: ')])
  })

  it('refuses a note in a job tech list', () => {
    const master = JSON.parse(repo.read('cv/master.json'))
    for (const job of master.work)
      if (job.id === 'brightwell') job.tech = [...(masterTech('brightwell') ?? []), 'Go (todo)']
    repo.write('cv/master.json', `${JSON.stringify(master, null, 2)}\n`)
    expect(voiceErrorsAt()).toEqual([expect.stringContaining('cv work: ')])
  })
})

describe('a copy whose cv.yaml has its own word lists', () => {
  it('takes effect in the CV lint', () => {
    repo.write(
      'config/cv.yaml',
      `${repo.read('config/cv.yaml').replace(/^note_words:.*\n/m, '')}note_words: [fnord]\n`,
    )
    larkspur.writeVariant((v) => {
      v.headline = 'Engineer (fnord)'
    })
    expect(messages(roleProblems(), 'error')).toEqual([expect.stringContaining('"(fnord)"')])
  })
})

describe('a copy whose cv.yaml lacks the word lists', () => {
  const dropLists = () =>
    repo.write(
      'config/cv.yaml',
      repo
        .read('config/cv.yaml')
        .replace(/^(error_pronouns|warning_pronouns|note_words):.*\n/gm, ''),
    )

  it('refuses a note by the defaults', () => {
    dropLists()
    expect(errorsFor(variant())).toEqual([])
    larkspur.writeVariant((v) => {
      v.headline = 'Engineer (todo)'
    })
    expect(messages(roleProblems(), 'error')).toEqual([expect.stringContaining('"(todo)"')])
  })

  it('still warns about a figure on file', () => {
    dropLists()
    setFigure(`${DOCK_FIGURE} (his estimate)`)
    const warned = repo
      .workspace()
      .check()
      .problems.filter((p) => p.level === 'warning' && p.slug === 'profile/wins.yaml')
    expect(warned).toEqual([
      expect.objectContaining({ message: expect.stringContaining('(his estimate)') }),
    ])
  })
})

describe('the example persona', () => {
  it('holds no voice finding in its built CVs', async () => {
    const root = resolve(import.meta.dirname, '../../examples/austin-backend')
    const ws = openWorkspace(root, async () => undefined)
    const found = [...ws.check().problems, ...ws.lintCvs().problems].filter((p) =>
      /pronoun|bracketed note|the figure holds/.test(p.message),
    )
    expect(found).toEqual([])
  })
})
