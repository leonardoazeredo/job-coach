import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, voiceFindings } from '../lib/cv-voice.ts'
import { variant } from './fixtures.ts'
import {
  errorsFor,
  larkspur,
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
  ])('trips nothing on "%s"', (text) => {
    expect(voiceFindings(text, DEFAULT_VOICE)).toEqual([])
  })

  it('reports a capital I on its own, any case of the other words, and a bracketed note once', () => {
    expect(
      voiceFindings('I built it. HIS team.', DEFAULT_VOICE)
        .map((f) => f.phrase)
        .sort(),
    ).toEqual(['HIS', 'I'])
    expect(voiceFindings('down 20% (his estimate)', DEFAULT_VOICE)).toEqual([
      { level: 'error', phrase: '(his estimate)' },
    ])
    expect(voiceFindings('i built it', DEFAULT_VOICE)).toEqual([])
  })
})

describe('the voice check on a built CV', () => {
  it('refuses a note and a pronoun in a quoted figure, and a pronoun in each of two bullets, once each', () => {
    setFigure(`${DOCK_FIGURE} (his estimate)`)
    const figureNote = errorsFor(costBullet(`${DOCK_FIGURE} (his estimate)`))
    expect(figureNote).toEqual([expect.stringContaining('"(his estimate)"')])
    expect(figureNote[0]).toContain("achievement's figure needs rewording")
    expect(figureNote[0]).toContain('brightwell bullet 1')

    setFigure(`${DOCK_FIGURE} by my team`)
    const figurePronoun = errorsFor(costBullet(`${DOCK_FIGURE} by my team`))
    expect(figurePronoun).toEqual([expect.stringContaining('"my"')])
    expect(figurePronoun[0]).toContain("achievement's figure needs rewording")

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
    setFigure(DOCK_FIGURE)
    const found = errorsFor(v)
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('"He"')
    expect(found[0]).toContain('brightwell bullet 1')
    expect(found[1]).toContain('"his"')
    expect(found[1]).not.toContain('figure needs rewording')
  })

  it('passes the same CV with the wording fixed', () => {
    setFigure(DOCK_FIGURE)
    expect(errorsFor(costBullet(DOCK_FIGURE))).toEqual([])
  })

  it('warns on "their" without refusing', () => {
    const v = withBullet('brightwell', 'Moved their label printing to Lambda.', ['win:bw-aws-cost'])
    expect(errorsFor(v)).toEqual([])
    expect(warningsFor(v)).toEqual(expect.arrayContaining([expect.stringContaining('"their"')]))
  })

  it('refuses a pronoun in the headline and in text only master.json supplies', () => {
    larkspur.writeVariant((v) => {
      v.headline = 'Backend engineer who builds what she ships'
    })
    expect(messages(roleProblems(), 'error')).toEqual([
      expect.stringContaining('cv headline: has the pronoun "she"'),
    ])
  })

  it('treats a copy whose cv.yaml lacks the lists as having the defaults', () => {
    const rules = repo
      .read('config/cv.yaml')
      .replace(/^(error_pronouns|warning_pronouns|note_words):.*\n/gm, '')
    repo.write('config/cv.yaml', rules)
    expect(errorsFor(variant())).toEqual([])
    larkspur.writeVariant((v) => {
      v.headline = 'Engineer (todo)'
    })
    expect(messages(roleProblems(), 'error')).toEqual([expect.stringContaining('"(todo)"')])
  })
})
