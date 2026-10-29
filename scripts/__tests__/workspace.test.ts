import { describe, expect, it } from 'vitest'
import type { Record } from '../lib/schema.ts'
import { SLUG } from './fixtures.ts'
import {
  errors,
  larkspur,
  plain,
  proposeWin,
  repo,
  useWorkspaceRepo,
  writeBullet,
} from './workspace-repo.ts'

useWorkspaceRepo()

describe('check', () => {
  it('passes a consistent pipeline', () => {
    const result = repo.workspace().check()
    expect(errors(result.problems)).toEqual([])
    expect(result.roles).toBe(2)
  })

  it('reports a malformed profile file by name and still checks the records', () => {
    repo.write('profile/wins.yaml', 'wins:\n  - slug: broken\n')
    plain.editYaml<Record>('record.yaml', (r) => {
      r.status = 'Paused'
    })
    const found = errors(repo.workspace().check().problems)
    expect(found).toContainEqual(expect.stringMatching(/^profile\/wins\.yaml: could not be read: /))
    expect(found).toContain('plain-role: status "Paused" is not in rules.yaml statuses')
  })

  it('reports an unreadable experience bank instead of throwing', () => {
    repo.remove('experience-bank')
    repo.write('experience-bank', 'not a directory')
    expect(errors(repo.workspace().check().problems)).toEqual([
      expect.stringMatching(/^experience-bank: could not be read: /),
    ])
  })

  it('reports a missing experience bank through profile()', () => {
    repo.remove('experience-bank')
    expect(repo.workspace().profile().problems).toEqual([
      { slug: 'experience-bank', level: 'error', message: 'is missing' },
    ])
  })

  it('reports an unreadable experience bank through profile()', () => {
    repo.remove('experience-bank')
    repo.write('experience-bank', 'not a directory')
    expect(repo.workspace().profile().problems).toEqual([
      {
        slug: 'experience-bank',
        level: 'error',
        message: expect.stringMatching(/^could not be read: /),
      },
    ])
  })

  it('fails a hook that names a proposed win or a win that does not exist', () => {
    proposeWin('bw-stakeholder-reviews', 'cedarline-payments')
    plain.editYaml<Record>('record.yaml', (r) => {
      r.hook = { win_slugs: ['bw-stakeholder-reviews', 'no-such-win', 'bw-dock-scheduling'] }
    })
    expect(errors(repo.workspace().check().problems)).toEqual([
      'plain-role: hook.win_slugs: win:bw-stakeholder-reviews: win is not approved',
      'plain-role: hook.win_slugs: win:no-such-win: no such win in profile/wins.yaml',
    ])
  })

  it('reports a malformed rules file instead of throwing', () => {
    repo.write('config/rules.yaml', 'statuses: [unclosed\n')
    expect(errors(repo.workspace().check().problems)).toEqual([
      expect.stringMatching(/^config\/rules\.yaml: could not be read: [^\n]+$/),
    ])
  })

  it('reports inconsistent rules once and still checks the records', () => {
    repo.editRules((r) => {
      r.board_groups.waiting = []
    })
    plain.editYaml<Record>('record.yaml', (r) => {
      r.status = 'Paused'
    })
    expect(errors(repo.workspace().check().problems)).toEqual([
      'config/rules.yaml: status "Applied" appears in 0 board groups, expected 1',
      'plain-role: status "Paused" is not in rules.yaml statuses',
    ])
  })
})

describe('lintCvs', () => {
  it('checks every role with CV files and skips the rest', () => {
    const result = repo.workspace().lintCvs()
    expect(errors(result.problems)).toEqual([])
    expect(result.checked).toBe(1)
  })

  it('fails a named slug with no folder', () => {
    const result = repo.workspace().lintCvs('no-such-role')
    expect(errors(result.problems)).toEqual(['no-such-role: no pipeline/no-such-role folder'])
    expect(result.checked).toBe(0)
  })

  it('fails a named slug with no CV files', () => {
    expect(errors(repo.workspace().lintCvs('plain-role').problems)).toEqual([
      'plain-role: requirements.yaml is missing',
      'plain-role: cv/bullets.yaml is missing',
    ])
  })

  it('reports malformed YAML and a file naming another role', () => {
    larkspur.write('requirements.yaml', 'role: [unclosed\n')
    larkspur.writeVariant((v) => {
      v.role = 'other-role'
    })
    const found = errors(repo.workspace().lintCvs(SLUG).problems)
    expect(found).toContainEqual(
      expect.stringMatching(/^larkspur-backend-engineer: requirements\.yaml could not be read: /),
    )
    expect(found).toContain(
      'larkspur-backend-engineer: cv/bullets.yaml role "other-role" differs from the folder',
    )
  })
})

describe('source refs in a CV', () => {
  const lint = () => errors(repo.workspace().lintCvs(SLUG).problems)

  it('resolves approved wins, answered questions, history and stack', () => {
    writeBullet(undefined, 'Frontend engineer.', [
      'win:bw-dock-scheduling',
      'bank:brightwell#2',
      'history:cedarline-payments',
      'stack',
    ])
    expect(lint()).toEqual([])
  })

  it('refuses unanswered questions and names the allowed kinds for an unknown one', () => {
    writeBullet(undefined, 'Frontend engineer.', ['bank:brightwell#3', 'memory:chat'])
    expect(lint()).toEqual([
      `${SLUG}: cv summary: bank:brightwell#3: question has no answer`,
      `${SLUG}: cv summary: memory:chat: unknown source kind (use win:, bank:, history: or stack)`,
    ])
  })

  it('refuses malformed refs, naming each one', () => {
    writeBullet(undefined, 'Frontend engineer.', ['win:', 'bank:brightwell', 'history:'])
    expect(lint()).toEqual([
      `${SLUG}: cv summary: win:: malformed ref (write win:<slug>)`,
      `${SLUG}: cv summary: bank:brightwell: malformed ref (write bank:<role-id>#<n>)`,
      `${SLUG}: cv summary: history:: malformed ref (write history:<role-id>)`,
    ])
  })

  it.each(['win:bw-dock-scheduling', 'bank:brightwell#2', 'history:brightwell'])(
    'refuses %s under another job',
    (ref) => {
      writeBullet('cedarline-payments', 'Frontend engineer.', [ref])
      expect(lint()).toEqual([
        `${SLUG}: cv cedarline-payments bullet 1: ${ref} belongs to brightwell, not cedarline-payments`,
      ])
    },
  )

  it('accepts stack under any job', () => {
    writeBullet('cedarline-payments', 'Frontend engineer.', ['stack'])
    expect(lint()).toEqual([])
  })
})

describe('rules', () => {
  it('returns the rules, or a problem naming the file', () => {
    expect(repo.workspace().rules().rules?.statuses).toContain('Applied')
    repo.write('config/rules.yaml', 'statuses: 3\n')
    expect(repo.workspace().rules()).toMatchObject({
      rules: undefined,
      problems: [{ slug: 'config/rules.yaml', level: 'error' }],
    })
  })

  it('names a missing search preference or one of the wrong type', () => {
    type Loose = { discovery: { search?: { [key: string]: unknown } } }
    repo.editYaml<Loose>('profile/search.yaml', (r) => {
      delete r.discovery.search
    })
    expect(repo.workspace().rules().problems[0]?.message).toMatch(
      /could not be read: discovery\.search/,
    )

    repo.editYaml<Loose>('profile/search.yaml', (r) => {
      r.discovery.search = { hybrid: 'yes' }
    })
    expect(repo.workspace().rules().problems[0]?.message).toMatch(/discovery\.search\.hybrid/)
  })
})

describe('today and the locale from identity.yaml', () => {
  it('writes the ISO day whatever the locale the identity names', () => {
    repo.editYaml<{ locale?: string }>('profile/identity.yaml', (i) => {
      i.locale = 'ar-EG'
    })
    expect(repo.workspace().today({ now: new Date('2026-06-16T03:30:00Z') }).today).toBe(
      '2026-06-15',
    )
  })

  it('reports a locale that is not a language tag', () => {
    repo.editYaml<{ locale?: string }>('profile/identity.yaml', (i) => {
      i.locale = 'not a locale'
    })
    expect(repo.workspace().today({ now: new Date() })).toEqual({
      today: undefined,
      problems: [
        {
          slug: 'profile/identity.yaml',
          level: 'error',
          message: 'locale "not a locale" is not a language tag',
        },
      ],
    })
  })
})

describe('the competency pack chosen in identity.yaml', () => {
  const profileProblems = () =>
    repo
      .workspace()
      .profile()
      .problems.map((p) => `${p.slug}: ${p.message}`)

  it('loads config/competencies/<pack>.yaml for the pack the identity names', () => {
    const { profile, problems } = repo.workspace().profile()
    expect(problems).toEqual([])
    expect(profile?.competencies.competencies.map((c) => c.id)).toContain('stakeholder-management')
  })

  it('reports a pack that has no file', () => {
    repo.editYaml<{ competency_pack?: string }>('profile/identity.yaml', (i) => {
      i.competency_pack = 'data'
    })
    expect(profileProblems()).toEqual(['config/competencies/data.yaml: is missing'])
  })

  it('falls back to the frontend pack the engine ships when the identity names none', () => {
    repo.editYaml<{ competency_pack?: string }>('profile/identity.yaml', (i) => {
      delete i.competency_pack
    })
    expect(profileProblems()).toEqual(['config/competencies/frontend.yaml: is missing'])
  })

  it('refuses a pack name that could leave the competencies folder', () => {
    repo.editYaml<{ competency_pack?: string }>('profile/identity.yaml', (i) => {
      i.competency_pack = '../cv'
    })
    expect(profileProblems()).toEqual([
      expect.stringMatching(/^profile\/identity\.yaml: could not be read: competency_pack/),
    ])
  })
})

describe('rules split across two files', () => {
  it('merges the engine defaults with the personal search profile', () => {
    const { rules, problems } = repo.workspace().rules()
    expect(problems).toEqual([])
    expect(rules?.statuses).toContain('Applied')
    expect(rules?.tiers['0']?.label).toBe('Stretch worth the effort')
    expect(rules?.fit.untiered).toEqual(['Not a fit'])
    expect(rules?.fit.min_stack_overlap_pct).toBe(80)
    expect(rules?.discovery.fresh_days).toBe(60)
    expect(rules?.discovery.search.city).toBe('Austin')
  })

  it('reports a missing search profile by its own path, not as a rules problem', () => {
    repo.remove('profile/search.yaml')
    expect(repo.workspace().rules()).toEqual({
      rules: undefined,
      problems: [{ slug: 'profile/search.yaml', level: 'error', message: 'is missing' }],
    })
  })

  it('reports both files when both are unreadable', () => {
    repo.write('config/rules.yaml', 'statuses: 3\n')
    repo.write('profile/search.yaml', 'tiers: 3\n')
    expect(
      repo
        .workspace()
        .rules()
        .problems.map((p) => p.slug),
    ).toEqual(['config/rules.yaml', 'profile/search.yaml'])
  })
})

describe('today', () => {
  const eveningJune = new Date('2026-06-16T03:30:00Z')

  it('is the day in the timezone from profile/identity.yaml', () => {
    expect(repo.workspace().today({ now: eveningJune })).toEqual({
      today: '2026-06-15',
      problems: [],
    })
  })

  it('is a given day, without reading profile/identity.yaml', () => {
    repo.remove('profile/identity.yaml')
    expect(repo.workspace().today({ given: '2026-10-27' })).toEqual({
      today: '2026-10-27',
      problems: [],
    })
  })

  it('reports a missing identity file, a missing timezone and an unknown one', () => {
    const today = () => {
      const t = repo.workspace().today({ now: eveningJune })
      return { today: t.today, problems: errors(t.problems) }
    }
    repo.remove('profile/identity.yaml')
    expect(today()).toEqual({
      today: undefined,
      problems: ['profile/identity.yaml: is missing'],
    })
    repo.write('profile/identity.yaml', 'name: Dana Okafor\nlocation:\n  city: Austin\n')
    expect(today()).toEqual({
      today: undefined,
      problems: [
        expect.stringMatching(/^profile\/identity\.yaml: could not be read: location\.timezone/),
      ],
    })
    repo.write('profile/identity.yaml', 'name: Dana Okafor\nlocation:\n  timezone: Mars/Olympus\n')
    expect(today()).toEqual({
      today: undefined,
      problems: ['profile/identity.yaml: location.timezone "Mars/Olympus" is not a timezone'],
    })
  })
})
