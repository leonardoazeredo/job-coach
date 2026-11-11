import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, voiceFindings } from '../lib/cv-voice.ts'
import { errorsFor, withBullet } from './role-cv-helpers.ts'

describe('a pronoun in Title Case inside a name', () => {
  it.each([
    'Wrote for Her Campus',
    'Helped Me Grow ship',
    'Shipped it (Her Campus)',
    '(Help Me Grow)',
    'Clients: Her Campus and Vox',
    'Partners: Me & Em',
    'Publications; Her Campus',
    '( Her Campus)',
    '(Me & Em)',
    "Shipped it - His Majesty's Treasury",
  ])('passes "%s"', (text) => {
    expect(voiceFindings(text, DEFAULT_VOICE)).toEqual([])
  })

  it.each([
    ['Her team shipped it', 'Her'],
    ['Built it. He scaled it', 'He'],
    ['Built it! He scaled it', 'He'],
    ['Shipped what he built', 'he'],
    ['Phase I done', 'I'],
    ['Shipped it (he built it)', '(he built it)'],
    ['Shipped it (He built it)', '(He built it)'],
    ['Shipped it (Her team did this)', '(Her team did this)'],
    ['Shipped it (My guess)', '(My guess)'],
    ['(His figure)', '(His figure)'],
    ['(Her words)', '(Her words)'],
    ['Built it? He scaled it', 'He'],
    ['Shipped it: He scaled it', 'He'],
    ['Shipped; He scaled it', 'He'],
    ['Built it… He scaled it', 'He'],
    ['Built it... He scaled it', 'He'],
    ['( Her team)', '( Her team)'],
    ['Shipped it (Her Campus) and (My guess)', '(My guess)'],
    ['Built it?\nHe scaled it', 'He'],
    ['Shipped it\nHer team scaled', 'Her'],
  ])('refuses "%s"', (text, phrase) => {
    expect(voiceFindings(text, DEFAULT_VOICE).map((f) => f.phrase)).toEqual([phrase])
  })

  it('refuses it in a bullet at the start of the line', () => {
    const v = withBullet('brightwell', 'Her team shipped it.', ['win:bw-aws-cost'])
    expect(errorsFor(v)).toEqual([expect.stringContaining('"Her"')])
  })

  it('passes it mid-sentence in a bullet', () => {
    const v = withBullet('brightwell', 'Wrote for Her Campus.', ['win:bw-aws-cost'])
    expect(errorsFor(v)).toEqual([])
  })
})
