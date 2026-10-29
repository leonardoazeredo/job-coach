import { describe, expect, it } from 'vitest'
import { SLUG } from './fixtures.ts'
import { plain, repo, useWorkspaceRepo } from './workspace-repo.ts'

useWorkspaceRepo()

describe('discovery', () => {
  const discovery = () => {
    const { discovery } = repo.workspace().discovery()
    if (!discovery) throw new Error('no Discovery')
    return discovery
  }

  it('matches a tracked role by company and title', () => {
    repo.addRole('quartzly-ui', { company: 'Quartzly', job_title: 'UI Engineer' })
    expect(discovery().match('Quartzly', 'Senior UI Engineer')).toEqual({
      kind: 'tracked',
      role: { slug: 'quartzly-ui', status: 'Applied' },
    })
  })

  it('lists every role at a tracked company when no title matches', () => {
    expect(discovery().match('Larkspur Freight', 'Platform Engineer')).toEqual({
      kind: 'company',
      roles: [
        { slug: SLUG, status: 'Identified' },
        { slug: 'plain-role', status: 'Identified' },
      ],
    })
  })

  it('matches across case, punctuation and legal or domain suffixes', () => {
    repo.addRole('hollowmere-fe', { company: 'Hollowmere.io', job_title: 'Front-end Engineer' })
    const { match } = discovery()
    expect(match('LARKSPUR Freight Ltd.', 'backend-engineer')).toMatchObject({
      kind: 'tracked',
      role: { slug: SLUG },
    })
    expect(match('Hollowmere Ltd', 'Front End Engineer')).toMatchObject({
      kind: 'tracked',
      role: { slug: 'hollowmere-fe' },
    })
  })

  it('leaves a listing at an untracked company new', () => {
    expect(discovery().match('Marrowbrook', 'Support Engineer')).toEqual({ kind: 'new' })
  })

  it('reports an unreadable record instead of treating it as untracked', () => {
    plain.write('record.yaml', 'company: [unclosed\n')
    const { discovery: d, problems } = repo.workspace().discovery()
    expect(problems).toEqual([
      {
        slug: 'plain-role',
        level: 'error',
        message: expect.stringMatching(/^record\.yaml could not be read: /),
      },
    ])
    expect(d?.match('Larkspur Freight', 'Platform Engineer')).toEqual({
      kind: 'company',
      roles: [{ slug: SLUG, status: 'Identified' }],
    })
  })

  it('qualifies a title listed only in search.yaml title_expansion', () => {
    expect(discovery().qualifies('Solutions Architect')).toBe(false)
    repo.editSearch((r) => {
      r.discovery.title_expansion.push('Solutions Architect')
    })
    const { discovery: d, problems } = repo.workspace().discovery()
    expect(problems).toEqual([])
    expect(d?.qualifies('Senior Solutions Architect')).toBe(true)
    expect(d?.qualifies('Founding Platform Engineer')).toBe(true)
    expect(d?.qualifies('Member of Technical Staff')).toBe(true)
  })

  it('qualifies the -ing form of the live expansion titles', () => {
    const { qualifies } = discovery()
    expect(qualifies('Product Engineering Lead')).toBe(true)
    expect(qualifies('Payments Engineering Lead')).toBe(true)
    expect(qualifies('Founding Platform Engineer')).toBe(true)
  })

  it('qualifies a bare Engineering title, since a missed role costs more than noise', () => {
    const { qualifies } = discovery()
    expect(qualifies('Founding Engineering Lead')).toBe(true)
    expect(qualifies('Product Engineering')).toBe(true)
  })

  it('keeps excluded words winning over the -ing form', () => {
    const { qualifies } = discovery()
    expect(qualifies('Engineering Manager')).toBe(false)
    expect(qualifies('Product Engineering Manager')).toBe(false)
  })

  it('does not stretch an expansion title into other word endings', () => {
    const { qualifies } = discovery()
    expect(qualifies('Product Engineerx')).toBe(false)
    expect(qualifies('Product Engineers')).toBe(false)
  })

  it('qualifies the title forms the first real pull missed', () => {
    const { qualifies } = discovery()
    expect(qualifies('Staff Tech Lead, Platform & Developer Products')).toBe(true)
    expect(qualifies('Software Developer, Platform')).toBe(true)
    expect(qualifies('Payments Engineer - Americas')).toBe(true)
    expect(qualifies('Senior Payments Engineer')).toBe(true)
    expect(qualifies('Senior Software Engineer, Ledger Core')).toBe(true)
  })

  it('rejects an excluded title even when it names a frontend term', () => {
    const { qualifies } = discovery()
    expect(qualifies('Senior Frontend Engineer')).toBe(true)
    expect(qualifies('Junior Frontend Engineer')).toBe(false)
    expect(qualifies('Full-stack React Developer')).toBe(false)
    expect(qualifies('Frontend Engineering Manager')).toBe(false)
  })

  it('lets a full-stack title in only through an explicit front-end term or an expansion title', () => {
    const { qualifies } = discovery()
    expect(qualifies('Senior Front-End/Full-Stack Engineer')).toBe(true)
    expect(qualifies('Product Engineer – Front-End, Full-Stack')).toBe(true)
    expect(qualifies('Full-Stack Engineer (Frontend-Leaning) - CreativeMusic')).toBe(true)
    expect(qualifies('Senior Full Stack Product Engineer (TypeScript)')).toBe(true)
    expect(qualifies('Full-Stack Product Engineer, AI Tools')).toBe(true)
    expect(qualifies('Senior Full Stack Engineer (Javascript)')).toBe(false)
    expect(qualifies('Full-Stack Product Engineering Manager')).toBe(false)
  })

  it('builds a Discovery with no problems when the status rules are inconsistent', () => {
    repo.editRules((r) => {
      r.board_groups.waiting = []
    })
    const { discovery: d, problems } = repo.workspace().discovery()
    expect(problems).toEqual([])
    expect(d?.match('Marrowbrook', 'Support Engineer')).toEqual({ kind: 'new' })
  })

  it('returns no Discovery with the rules problem when rules.yaml is unreadable, and freshDays from the rules', () => {
    repo.editRules((r) => {
      r.discovery.fresh_days = 30
    })
    expect(discovery().freshDays).toBe(30)
    repo.write('config/rules.yaml', 'statuses: [unclosed\n')
    expect(repo.workspace().discovery()).toEqual({
      discovery: undefined,
      problems: [
        {
          slug: 'config/rules.yaml',
          level: 'error',
          message: expect.stringMatching(/^could not be read: /),
        },
      ],
    })
  })
})
