import { describe, expect, it } from 'vitest'
import { SLUG } from './fixtures.ts'
import { plain, repo, useWorkspaceRepo } from './workspace-repo.ts'

useWorkspaceRepo()

const discovery = () => {
  const { discovery } = repo.workspace().discovery()
  if (!discovery) throw new Error('no Discovery')
  return discovery
}

describe('discovery matching', () => {
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
})

describe('discovery title qualifying', () => {
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
})

// A search for another field, so the gate is shown to hold no field of its own.
const searchFor = (lists: {
  titles: string[]
  expansion?: string[]
  terms?: string[]
  excluded?: string[]
}) =>
  repo.editSearch((r) => {
    r.discovery.search_titles = lists.titles
    r.discovery.title_expansion = lists.expansion ?? []
    r.discovery.field_terms = lists.terms ?? []
    r.discovery.excluded_words = lists.excluded ?? []
  })

describe("a qualifying title names the user's own words", () => {
  it('qualifies every Search title of the example persona', () => {
    const { search_titles, title_expansion } = repo.workspace().rules().rules?.discovery ?? {
      search_titles: [],
      title_expansion: [],
    }
    const titles = [...search_titles, ...title_expansion]
    expect(titles.length).toBeGreaterThan(0)
    expect(titles.filter((t) => !discovery().qualifies(t))).toEqual([])
  })

  it('holds no field of its own', () => {
    searchFor({ titles: ['Transport Planner'] })
    const { qualifies } = discovery()
    expect(qualifies('Senior Transport Planner')).toBe(true)
    expect(qualifies('Frontend Engineer')).toBe(false)
    expect(qualifies('React Developer')).toBe(false)
  })

  it('lets a title lift an engine word for that word only', () => {
    searchFor({ titles: ['Transport Manager'] })
    const { qualifies } = discovery()
    expect(qualifies('Regional Transport Manager')).toBe(true)
    expect(qualifies('Engineering Manager')).toBe(false)
    expect(qualifies('Junior Transport Manager')).toBe(false)
  })

  it('lets a Field term qualify a title and lift an engine word', () => {
    searchFor({ titles: ['Web Engineer'], terms: ['React', 'designer'] })
    const { qualifies } = discovery()
    expect(qualifies('Senior React Developer')).toBe(true)
    expect(qualifies('Product Designer')).toBe(true)
    expect(qualifies('Junior React Developer')).toBe(false)
  })

  it('lifts every form of an engine word', () => {
    searchFor({ titles: ['Test Engineer'] })
    expect(discovery().qualifies('Testing Test Engineer')).toBe(true)
  })

  it("lets the user's own Excluded word beat a Search title and a Field term", () => {
    searchFor({
      titles: ['Software Engineer'],
      terms: ['React'],
      excluded: ['mobile', 'full-stack'],
    })
    const { qualifies } = discovery()
    expect(qualifies('Software Engineer')).toBe(true)
    expect(qualifies('Software Engineer, Mobile')).toBe(false)
    expect(qualifies('Full Stack React Developer')).toBe(false)
    expect(qualifies('Fullstack Software Engineer')).toBe(false)
  })

  it('has no full-stack rule of its own', () => {
    searchFor({ titles: ['Software Engineer'], terms: ['JavaScript'] })
    expect(discovery().qualifies('Senior Full Stack Engineer (Javascript)')).toBe(true)
  })

  it('keeps a front-end search working from its own lists', () => {
    searchFor({
      titles: ['Frontend Engineer'],
      expansion: ['Product Engineer'],
      terms: ['front-end', 'UI', 'React', 'design system'],
      excluded: ['back-end', 'mobile', 'iOS', 'Android'],
    })
    const { qualifies } = discovery()
    expect(qualifies('Senior Frontend Engineer')).toBe(true)
    expect(qualifies('Junior Frontend Engineer')).toBe(false)
    expect(qualifies('Frontend Engineering Manager')).toBe(false)
    expect(qualifies('Senior Front-End/Full-Stack Engineer')).toBe(true)
    expect(qualifies('Full-Stack Engineer (Frontend-Leaning)')).toBe(true)
    expect(qualifies('Full-Stack Product Engineering Manager')).toBe(false)
    expect(qualifies('Backend Product Engineer')).toBe(false)
    expect(qualifies('Staff Design Systems Engineer')).toBe(false)
  })
})

describe('a title is matched by its words, however they are spelled', () => {
  it.each([
    ['Frontend', 'Front-End Developer'],
    ['Frontend', 'Front End Developer'],
    ['front-end', 'Frontend Developer'],
    ['front end', 'Senior Frontend-Leaning Developer'],
    ['React Native', 'ReactNative Developer'],
    ['Vue.js', 'Vuejs Developer'],
    ['C#', 'Senior C# Developer'],
  ])('term %s admits %s', (term, title) => {
    searchFor({ titles: ['Web Engineer'], terms: [term] })
    expect(discovery().qualifies(title)).toBe(true)
  })

  it.each([
    ['UI', 'Building Engineer'],
    ['React', 'ReactJS Developer'],
    ['C#', 'Senior C Developer'],
  ])('term %s does not admit %s', (term, title) => {
    searchFor({ titles: ['Web Engineer'], terms: [term] })
    expect(discovery().qualifies(title)).toBe(false)
  })

  it('spells a Search title and an Excluded word the same way', () => {
    searchFor({ titles: ['Front End Engineer'], excluded: ['full-stack'] })
    const { qualifies } = discovery()
    expect(qualifies('Frontend Engineer')).toBe(true)
    expect(qualifies('Front-End Platform Engineer')).toBe(true)
    expect(qualifies('Front End Fullstack Engineer')).toBe(false)
  })

  it('does not find an engine word inside another word', () => {
    searchFor({ titles: ['Engineer'] })
    const { qualifies } = discovery()
    expect(qualifies('Salesforce Engineer')).toBe(true)
    expect(qualifies('Latest Stack Engineer')).toBe(true)
    expect(qualifies('Internal Tools Engineer')).toBe(true)
    expect(qualifies('Sales Engineer')).toBe(false)
    expect(qualifies('Test Engineer')).toBe(false)
    expect(qualifies('Engineer Intern')).toBe(false)
  })
})

describe("the record check on the gate's lists", () => {
  const gateWarnings = () =>
    repo
      .workspace()
      .check()
      .problems.filter((p) => p.slug === 'profile/search.yaml' && p.level === 'warning')
      .map((p) => p.message)

  it('is silent on the example persona', () => {
    expect(gateWarnings()).toEqual([])
  })

  it('warns when no Field terms were ever chosen, and not when the choice was none', () => {
    repo.editSearch((r) => {
      delete r.discovery.field_terms
    })
    expect(gateWarnings()).toEqual([expect.stringMatching(/field_terms/)])
    expect(repo.workspace().discovery().discovery?.qualifies('Backend Engineer')).toBe(true)
    repo.editSearch((r) => {
      r.discovery.field_terms = []
    })
    expect(gateWarnings()).toEqual([])
  })

  it("warns when a Search title or Field term holds the user's own Excluded word", () => {
    searchFor({ titles: ['Backend Engineer'], terms: ['Mobile'], excluded: ['back-end', 'mobile'] })
    expect(gateWarnings()).toEqual([
      expect.stringMatching(/"Backend Engineer".*"back-end"/),
      expect.stringMatching(/"Mobile".*"mobile"/),
    ])
  })
})

describe('discovery rules problems', () => {
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
