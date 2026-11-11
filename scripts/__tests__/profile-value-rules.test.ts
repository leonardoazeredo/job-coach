import { describe, expect, it } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { draft, personaFile, repo, run, useProfileRepo } from './profile-repo.ts'

useProfileRepo()

const IDENTITY = 'profile/identity.yaml'
const SEARCH = 'profile/search.yaml'
const HISTORY = 'profile/history.yaml'

const job = (employment_type: unknown) => ({
  roles: [{ id: 'brightwell', public: { employment_type } }],
})
const searching = (search: Record<string, unknown>) => ({ discovery: { search } })

describe('the Draft refuses a value a later step depends on', () => {
  it.each([
    ['Timezone', IDENTITY, { location: { timezone: 'Mars/Olympus' } }],
    ['Locale', IDENTITY, { locale: 'not a locale' }],
    ['Currency', IDENTITY, { compensation: { currency: 'QQQ' } }],
    ['Currency', IDENTITY, { compensation: { currency: 'usd' } }],
    ['Lowest base pay', IDENTITY, { compensation: { floor: 'lots' } }],
    ['Lowest', IDENTITY, { compensation: { by_level: { senior: { min: 'a', max: 200 } } } }],
    ['Highest', IDENTITY, { compensation: { by_level: { senior: { min: 100, max: 'b' } } } }],
    ['Employment type', HISTORY, job('banana')],
    ['Employment type', HISTORY, job('Permanent')],
    ['Employment searched', SEARCH, searching({ employment: 'permanent' })],
    ['Search levels', SEARCH, searching({ seniority: ['senior', 'mid'] })],
  ])('refuses a bad %s', async (label, file, values) => {
    const refused = await draft(file, values)
    expect(refused.code).toBe(EXIT.problems)
    expect(refused.stderr).toContain(`"${label}"`)
    expect((await run(['drafts'])).stdout).toContain('No drafts are waiting.')
  })

  it.each([
    [IDENTITY, { location: { timezone: 'Europe/Berlin' } }],
    [IDENTITY, { locale: 'en-GB' }],
    [IDENTITY, { compensation: { currency: 'EUR', floor: 90000 } }],
    [IDENTITY, { compensation: { by_level: { senior: { min: 100, max: 200 } } } }],
    [HISTORY, job('fixed-term')],
    [HISTORY, job('self-employed')],
    [SEARCH, searching({ employment: 'contract' })],
    [SEARCH, searching({ seniority: ['mid-level', 'expert'] })],
  ])('accepts a good value in %s', async (file, values) => {
    expect((await draft(file, values)).code).toBe(0)
  })

  it('does not refuse an old value the draft leaves alone', async () => {
    repo.editYaml<{ location: { timezone: string }; availability: string }>(IDENTITY, (id) => {
      id.location.timezone = 'Mars/Olympus'
    })
    expect((await draft(IDENTITY, { availability: 'From March' })).code).toBe(0)
  })

  it('takes what the user said for values nothing depends on', async () => {
    const taken = await draft(IDENTITY, {
      experience_years: '10+',
      work_setup: { office_days_ok: '2 to 3', remote: 'hybrid only' },
    })
    expect(taken.code).toBe(0)
    expect(taken.stdout).toContain('Years of experience: 10+')
    expect(taken.stdout).toContain('Office days a week: 2 to 3')
  })

  it('drafts the whole example persona', async () => {
    for (const file of [IDENTITY, SEARCH, HISTORY]) {
      const values = personaFile(file)
      repo.remove(file)
      expect((await draft(file, values)).stderr).toBe('')
    }
  })
})

describe('the summary says what a job site will not know', () => {
  const NOTE = 'One job site'

  it('notes an unknown country and leaves the choice to the user', async () => {
    const shown = await draft(SEARCH, searching({ country: 'Narnia' }))
    expect(shown.code).toBe(0)
    expect(shown.stdout).toContain(
      "One job site doesn't know Narnia, so it will show worldwide-remote roles only.",
    )
  })

  it('notes an unknown skill, and how to write one it knows in other letters', async () => {
    const shown = await draft(SEARCH, searching({ stack: ['Routewise', 'typescript', 'Python'] }))
    expect(shown.code).toBe(0)
    const notes = shown.stdout.split('\n').filter((l) => l.startsWith(NOTE))
    expect(notes).toEqual([
      "One job site doesn't know Routewise, so it won't search by it.",
      "One job site doesn't know typescript, so it won't search by it; it writes it TypeScript.",
    ])
  })

  it('says nothing for values it knows', async () => {
    const shown = await draft(SEARCH, searching({ country: 'Germany', stack: ['TypeScript'] }))
    expect(shown.stdout).not.toContain(NOTE)
  })

  it('says nothing about a value the draft leaves as it was', async () => {
    repo.editSearch((r) => {
      r.discovery.search.country = 'Narnia'
    })
    const shown = await draft(SEARCH, { fit: { min_stack_overlap_pct: 75 } })
    expect(shown.stdout).not.toContain(NOTE)
  })

  it('names no tool in the note', async () => {
    const shown = await draft(SEARCH, searching({ country: 'Narnia' }))
    expect(shown.stdout).not.toMatch(/rocketship|whatruns/i)
  })

  it('notes a new file too', async () => {
    const values = personaFile(SEARCH)
    values.discovery.search.country = 'Narnia'
    repo.remove(SEARCH)
    expect((await draft(SEARCH, values)).stdout).toContain("doesn't know Narnia")
  })
})

describe('the Draft refuses a figure that would not read on a CV', () => {
  it.each(['down 20% (his estimate)', 'cut by my team to 12 minutes', 'about 40 (approx)'])(
    'refuses "%s"',
    async (metric) => {
      const refused = await draft('profile/wins.yaml', { wins: [{ slug: 'bw-aws-cost', metric }] })
      expect(refused.code).toBe(EXIT.problems)
      expect(refused.stderr).toContain('needs a figure worded as it reads on a CV')
      expect((await run(['drafts'])).stdout).toContain('No drafts are waiting.')
    },
  )

  it('leaves a figure on file alone when the draft does not touch it', async () => {
    repo.editYaml<{ wins: { slug: string; metric: string }[] }>('profile/wins.yaml', (file) => {
      const win = file.wins.find((w) => w.slug === 'bw-aws-cost')
      if (win) win.metric = 'down 20% (his estimate)'
    })
    const taken = await draft('profile/wins.yaml', {
      wins: [{ slug: 'bw-aws-cost', action: 'Moved printing to Lambda.' }],
    })
    expect(taken.code).toBe(0)
  })
})
