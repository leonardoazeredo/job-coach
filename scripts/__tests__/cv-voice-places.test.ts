import { describe, expect, it } from 'vitest'
import { errorsFor, messages, repo, roleProblems, withBullet } from './role-cv-helpers.ts'

const voiceErrors = () =>
  messages(roleProblems(), 'error').filter((m) => /has the (pronoun|bracketed note)/.test(m))

const setNote = (note: string) =>
  repo.editYaml<{ roles: { id: string; public: { employment_type: string } }[] }>(
    'profile/history.yaml',
    (file) => {
      const role = file.roles.find((r) => r.id === 'brightwell')
      if (role) role.public.employment_type = note
    },
  )

describe('the voice check on prose only master.json or history.yaml supplies', () => {
  it('refuses a bracketed note in a job note and names the place', () => {
    setNote('contract (approx.)')
    expect(voiceErrors()).toEqual([expect.stringContaining('cv work: has the bracketed note')])
  })

  it('passes a job note holding a name', () => {
    setNote('contract for Her Campus')
    expect(voiceErrors()).toEqual([])
  })

  it('refuses a pronoun in the master summary when the variant has none', () => {
    const master = JSON.parse(repo.read('cv/master.json'))
    master.summary = 'Backend engineer who ships what he builds.'
    repo.write('cv/master.json', `${JSON.stringify(master, null, 2)}\n`)
    expect(voiceErrors()).toEqual([expect.stringContaining('cv summary: has the pronoun "he"')])
  })

  it('refuses a pronoun in a project, and passes a name in one', () => {
    const master = JSON.parse(repo.read('cv/master.json'))
    master.projects = ['Tool he wrote for the team']
    repo.write('cv/master.json', `${JSON.stringify(master, null, 2)}\n`)
    expect(voiceErrors()).toEqual([expect.stringContaining('cv projects: has the pronoun "he"')])
    master.projects = ['Site built for Her Campus']
    repo.write('cv/master.json', `${JSON.stringify(master, null, 2)}\n`)
    expect(voiceErrors()).toEqual([])
  })
})

describe('a pronoun the whole bullet and the figure both flag', () => {
  it('gives one error, worded as the figure', () => {
    const figure = 'his team cut it 20%'
    repo.editYaml<{ wins: { slug: string; metric: string }[] }>('profile/wins.yaml', (file) => {
      for (const win of file.wins) if (win.slug === 'bw-aws-cost') win.metric = figure
    })
    const found = errorsFor(
      withBullet('brightwell', `Moved printing, ${figure}.`, ['win:bw-aws-cost']),
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("achievement's figure needs rewording")
  })
})
