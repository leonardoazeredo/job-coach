import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { EXIT } from '../lib/problem.ts'
import { draft, drafted, personaFile, repo, run, useProfileRepo } from './profile-repo.ts'

useProfileRepo()

describe('profile draft of a copy that still holds template marks', () => {
  // A copy filled in by hand before the Draft module can still hold the template's marks.
  const marking = (find: string, mark: (line: string) => string) => {
    const text = repo.read('profile/identity.yaml')
    const line = text.split('\n').find((l) => l.includes(find)) ?? ''
    repo.write('profile/identity.yaml', text.replace(line, mark(line)))
  }

  it('refuses an untouched sample that the template marked on an inline map', async () => {
    marking(
      'mid: {min: 135000',
      () => '    mid: {min: 0, max: 0}      # CHANGE_ME your level name and range',
    )
    const shown = await draft('profile/identity.yaml', { availability: 'Two weeks' })
    expect(shown.code).toBe(EXIT.problems)
    expect(shown.stderr).toContain('"Pay range by level" still holds')
    expect((await run(['drafts'])).stdout).toBe('No drafts are waiting.\n')
  })

  it('refuses an untouched sample marked on the line above it, and takes it once given', async () => {
    marking('floor: 130000', (line) => `  # CHANGE_ME annual base\n${line}`)
    const shown = await draft('profile/identity.yaml', { availability: 'Two weeks' })
    expect(shown.code).toBe(EXIT.problems)
    expect(shown.stderr).toContain('"Lowest base pay" still holds')

    const given = await draft('profile/identity.yaml', { compensation: { floor: 140000 } })
    expect(given.stderr).toBe('')
    expect(drafted('profile/identity.yaml')).not.toContain('CHANGE_ME')
  })

  it('takes a marked value given again as it stands, as the answer', async () => {
    marking('office_days_ok: 2', (line) => `${line}  # CHANGE_ME most office days a week`)
    const kept = await draft('profile/identity.yaml', { work_setup: { office_days_ok: 2 } })
    expect(kept.stderr).toBe('')
    expect(kept.code).toBe(0)
    expect(drafted('profile/identity.yaml')).not.toContain('CHANGE_ME')

    const jobs = repo.read('profile/history.yaml')
    repo.write(
      'profile/history.yaml',
      jobs.replace(
        '      employment_type: self-employed',
        '      employment_type: self-employed # CHANGE_ME',
      ),
    )
    const job = await draft('profile/history.yaml', {
      roles: [{ id: 'independent', public: { employment_type: 'self-employed' } }],
    })
    expect(job.stderr).toBe('')
    expect(drafted('profile/history.yaml')).not.toContain('CHANGE_ME')
  })

  it('takes a marked header with no blank line after it as the header', async () => {
    const lines = repo.read('profile/identity.yaml').split('\n')
    // The persona's own header and the blank line after it give way to the template's mark.
    repo.write(
      'profile/identity.yaml',
      ['# CHANGE_ME marks a value still to replace.', ...lines.slice(2)].join('\n'),
    )
    const shown = await draft('profile/identity.yaml', { availability: 'Two weeks' })
    expect(shown.stderr).toBe('')
    expect(drafted('profile/identity.yaml')).not.toContain('CHANGE_ME')
  })

  // No template marks a section key (by_level, right_to_work, compensation, work_setup, roles,
  // tiers, core and the rest carry no CHANGE_ME), so a mark on one is the user's own note.
  it("keeps the user's own mark above a whole section, and drafts", async () => {
    marking('work_setup:', (line) => `# CHANGE_ME check these with her\n${line}`)
    const shown = await draft('profile/identity.yaml', { availability: 'Two weeks' })
    expect(shown.stderr).toBe('')
    expect(shown.stdout).toBe('Availability: Two weeks (was Free to start from 2026-11-16)\n')
    expect(drafted('profile/identity.yaml')).toContain(
      '# CHANGE_ME check these with her\nwork_setup:',
    )
  })

  it('refuses a marked inline map the input gives only in part, and takes it given whole', async () => {
    marking(
      'mid: {min: 135000',
      () => '    mid: {min: 0, max: 0}      # CHANGE_ME your level name and range',
    )
    const part = await draft('profile/identity.yaml', {
      compensation: { by_level: { mid: { min: 0 } } },
    })
    expect(part.code).toBe(EXIT.problems)
    expect(part.stderr).toContain('"Pay range by level" still holds')

    const whole = { compensation: { by_level: { mid: { min: 140000, max: 160000 } } } }
    const given = await draft('profile/identity.yaml', whole)
    expect(given.stderr).toBe('')
    expect(drafted('profile/identity.yaml')).not.toContain('CHANGE_ME')
  })

  // The input must give an item's id to reach the item, so that id does not answer a mark on it.
  it("keeps a mark on an item's id line when the draft changes another value of the item", async () => {
    const jobs = repo.read('profile/history.yaml')
    repo.write(
      'profile/history.yaml',
      jobs.replace('  - id: independent', '  - id: independent # CHANGE_ME'),
    )
    const shown = await draft('profile/history.yaml', {
      roles: [{ id: 'independent', summary: 'Booking services for clinics.' }],
    })
    expect(shown.stderr).toBe('')
    expect(drafted('profile/history.yaml')).toContain('- id: independent # CHANGE_ME')
  })
})

describe('values the templates mark as samples', () => {
  // The identity and search files share one onboarding section.
  const unfinished = () =>
    repo
      .workspace()
      .onboarding()
      .some((s) => s.id === 'identity' && s.placeholders.length > 0)

  // Each case puts the template's own marked line back into the persona's finished file.
  const cases = [
    {
      key: 'locale',
      file: 'profile/identity.yaml',
      marked: 'locale: en-US                  # CHANGE_ME BCP 47 language tag',
      given: { locale: 'en-US' },
    },
    {
      key: 'work_setup.remote',
      file: 'profile/identity.yaml',
      marked: 'remote: true                 # CHANGE_ME whether you accept fully remote work',
      given: { work_setup: { remote: true } },
    },
    {
      key: 'discovery.search.regions',
      file: 'profile/search.yaml',
      marked: 'regions: [CHANGE_ME Remote]',
      given: { discovery: { search: { regions: ['Remote'] } } },
    },
  ]

  it.each(cases)(
    'counts the file unfinished while $key is as the template has it',
    async ({ key, file, marked, given }) => {
      const text = repo.read(file)
      const name = key.split('.').at(-1) ?? ''
      const line = text.split('\n').find((l) => l.trim().startsWith(`${name}:`)) ?? ''
      expect(line).not.toBe('')
      expect(unfinished()).toBe(false)
      repo.write(file, text.replace(line, `${line.match(/^ */)?.[0]}${marked}`))
      expect(unfinished()).toBe(true)

      const shown = await draft(file, given)
      expect(shown.stderr).toBe('')
      expect(drafted(file)).not.toContain('CHANGE_ME')
    },
  )

  it('takes a new search file drafted without employment and hybrid, and shows both', async () => {
    const values = personaFile('profile/search.yaml')
    repo.remove('profile/search.yaml')
    delete values.discovery.search.employment
    delete values.discovery.search.hybrid
    const shown = await draft('profile/search.yaml', values)
    expect(shown.stderr).toBe('')
    expect(shown.code).toBe(0)
    expect(shown.stdout).toMatch(/^Employment searched: full-time$/m)
    expect(shown.stdout).toMatch(/^Include hybrid roles: yes$/m)
    const { employment, hybrid } = parse(drafted('profile/search.yaml')).discovery.search
    expect([employment, hybrid]).toEqual(['full-time', true])
  })
})
