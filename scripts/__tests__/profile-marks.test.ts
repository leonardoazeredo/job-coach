import { describe, expect, it } from 'vitest'
import { EXIT } from '../lib/problem.ts'
import { draft, drafted, repo, run, useProfileRepo } from './profile-repo.ts'

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

  it('names no value for a mark above a whole section, and drafts', async () => {
    marking('work_setup:', (line) => `# CHANGE_ME check these with her\n${line}`)
    const shown = await draft('profile/identity.yaml', { availability: 'Two weeks' })
    expect(shown.stderr).toBe('')
    expect(shown.stdout).toBe('Availability: Two weeks (was Free to start from 2026-11-16)\n')
  })
})
