import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE, voiceFindings } from '../lib/cv-voice.ts'
import { errorsFor, repo, warningsFor, withBullet } from './role-cv-helpers.ts'

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

describe('a pronoun in a quoted figure inside a longer bullet', () => {
  const quoting = (figure: string, bullet: string) => {
    repo.editYaml<{ wins: { slug: string; metric: string }[] }>('profile/wins.yaml', (file) => {
      for (const win of file.wins) if (win.slug === 'bw-aws-cost') win.metric = figure
    })
    return errorsFor(withBullet('brightwell', bullet, ['win:bw-aws-cost']))
  }

  it('is refused as the figure, though mid-sentence it reads as a name', () => {
    const found = quoting('He cut costs by 20%', 'Rebuilt the pipeline, He cut costs by 20%')
    expect(found).toEqual([expect.stringContaining('"He"')])
    expect(found[0]).toContain("achievement's figure needs rewording")
  })

  it('passes a name that follows a semicolon in the figure', () => {
    const figure = 'down 20%; Her Campus traffic up 5%'
    expect(quoting(figure, `Rebuilt the pipeline, ${figure}`)).toEqual([])
  })

  it('refuses a pronoun after a semicolon once, as the figure', () => {
    const figure = 'down 20%; He saved 3 days'
    const found = quoting(figure, `Rebuilt the pipeline, ${figure}`)
    expect(found).toEqual([expect.stringContaining('"He"')])
    expect(found[0]).toContain("achievement's figure needs rewording")
  })

  it('does not read a cited figure the bullet does not quote', () => {
    expect(quoting('He cut costs by 20%', 'Rebuilt the pipeline.')).toEqual([])
  })

  it('leaves a "their" in a quoted figure a warning', () => {
    repo.editYaml<{ wins: { slug: string; metric: string }[] }>('profile/wins.yaml', (file) => {
      for (const win of file.wins)
        if (win.slug === 'bw-aws-cost') win.metric = 'down 20% in their bill'
    })
    const v = withBullet('brightwell', 'Moved printing, down 20% in their bill.', [
      'win:bw-aws-cost',
    ])
    expect(errorsFor(v)).toEqual([])
    expect(warningsFor(v)).toEqual(expect.arrayContaining([expect.stringContaining('"their"')]))
  })

  it('passes a figure holding a name', () => {
    expect(
      quoting('down 20% for Her Campus', 'Rebuilt the pipeline, down 20% for Her Campus'),
    ).toEqual([])
  })
})
