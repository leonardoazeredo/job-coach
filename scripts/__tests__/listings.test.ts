import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Discovery } from '../lib/discovery.ts'
import {
  type Listing,
  readPulls,
  savePull,
  saveShortlist,
  shortlist,
  shortlistLine,
} from '../lib/listings.ts'
import { error } from '../lib/problem.ts'
import { type TempRepo, tempRepo } from './temp-repo.ts'

const today = '2026-10-26'

const stubDiscovery = (over: Partial<Discovery> = {}): Discovery => ({
  problems: [],
  match: () => ({ kind: 'new' }),
  qualifies: () => true,
  freshDays: 60,
  ...over,
})

const listing = (over: Partial<Listing> = {}): Listing => ({
  board: 'rocketship',
  company: 'Larkspur Freight',
  title: 'Frontend Engineer',
  url: 'https://example.com/larkspur/frontend-engineer',
  ...over,
})

describe('shortlist', () => {
  it('keeps one listing per company and title across boards, the richest, with every board counted', () => {
    const sparse = listing({
      board: 'whatruns',
      company: 'Larkspur Freight Ltd',
      title: 'Front-end Engineer',
    })
    const rich = listing({
      url: 'https://example.com/larkspur/rich',
      location: 'London',
      posted: '2026-10-20',
      pay: '£90k',
    })
    const { kept, dropped } = shortlist([sparse, rich], stubDiscovery(), today)
    expect(dropped).toEqual([])
    expect(kept).toEqual([
      {
        ...rich,
        match: { kind: 'new' },
        boards: ['whatruns', 'rocketship'],
        listings: 2,
      },
    ])
  })

  it('breaks a tie between equally rich duplicates by latest posted, then by pull order', () => {
    const older = listing({ url: 'https://example.com/older', posted: '2026-10-01' })
    const newer = listing({ url: 'https://example.com/newer', posted: '2026-10-20' })
    const first = listing({ url: 'https://example.com/first', pay: '£90k' })
    const second = listing({ url: 'https://example.com/second', pay: '£95k' })
    const { kept } = shortlist([older, newer, first, second], stubDiscovery(), today)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.url).toBe('https://example.com/newer')
    const undated = shortlist([first, second], stubDiscovery(), today)
    expect(undated.kept[0]?.url).toBe('https://example.com/first')
  })

  it('drops a listing whose title does not qualify', () => {
    const manager = listing({ company: 'Wise', title: 'Frontend Engineering Manager' })
    const engineer = listing({ company: 'Wise', title: 'Frontend Engineer' })
    const qualifies = (title: string) => !/manager/i.test(title)
    const { kept, dropped } = shortlist([manager, engineer], stubDiscovery({ qualifies }), today)
    expect(kept.map((l) => l.title)).toEqual(['Frontend Engineer'])
    expect(dropped).toEqual([{ listing: manager, reason: 'title' }])
  })

  it('drops a listing posted more than freshDays before today, and never an undated one', () => {
    const expired = listing({ company: 'Wise', posted: '2026-08-26' })
    const fresh = listing({ company: 'Quartzly', posted: '2026-08-27' })
    const undated = listing({ company: 'Larkspur Freight' })
    const { kept, dropped } = shortlist([expired, fresh, undated], stubDiscovery(), today)
    expect(kept.map((l) => l.company)).toEqual(['Quartzly', 'Larkspur Freight'])
    expect(dropped).toEqual([{ listing: expired, reason: 'expired' }])
  })

  it('marks each kept listing with the pipeline match for its company and title', () => {
    const match: Discovery['match'] = (company, title) =>
      company === 'Larkspur Freight' && title === 'Frontend Engineer'
        ? { kind: 'tracked', role: { slug: 'larkspur-fe', status: 'Applied' } }
        : { kind: 'new' }
    const { kept } = shortlist(
      [listing(), listing({ company: 'Wise' })],
      stubDiscovery({ match }),
      today,
    )
    expect(kept.map((l) => [l.company, l.match])).toEqual([
      ['Larkspur Freight', { kind: 'tracked', role: { slug: 'larkspur-fe', status: 'Applied' } }],
      ['Wise', { kind: 'new' }],
    ])
  })

  it('orders the shortlist newest first, undated last, then by company and title', () => {
    const rows = [
      listing({ company: 'Zopa', title: 'UI Engineer' }),
      listing({ company: 'Wise', posted: '2026-10-01' }),
      listing({ company: 'Larkspur Freight', title: 'Web Engineer', posted: '2026-10-20' }),
      listing({ company: 'Larkspur Freight', title: 'Frontend Engineer', posted: '2026-10-20' }),
      listing({ company: 'Quartzly' }),
    ]
    const { kept } = shortlist(rows, stubDiscovery(), today)
    expect(kept.map((l) => `${l.company} ${l.title}`)).toEqual([
      'Larkspur Freight Frontend Engineer',
      'Larkspur Freight Web Engineer',
      'Wise Frontend Engineer',
      'Quartzly Frontend Engineer',
      'Zopa UI Engineer',
    ])
  })
})

describe('readPulls', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = tempRepo()
  })
  afterEach(() => repo.dispose())

  const card = {
    board: 'whatruns',
    company: 'Larkspur Freight',
    title: 'Frontend Engineer',
    url: 'https://x',
  }
  const readOne = (entries: unknown[]) => {
    repo.write('pull.json', JSON.stringify(entries))
    return readPulls([repo.path('pull.json')])
  }

  it('reports a missing pull as missing, with no listings', () => {
    const gone = repo.path('gone.json')
    expect(readPulls([gone])).toEqual({
      listings: undefined,
      missing: true,
      problems: [error(gone, 'is missing')],
    })
  })

  it('words bad JSON as one line', () => {
    repo.write('bad.json', '[{"board": ')
    const { problems, listings, missing } = readPulls([repo.path('bad.json')])
    expect(listings).toBeUndefined()
    expect(missing).toBe(false)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.slug).toBe(repo.path('bad.json'))
    expect(problems[0]?.message).toMatch(/^could not be read: [^\n]+$/)
  })

  it('reads every path before it returns, so a missing and a bad file both show, in path order', () => {
    repo.write('bad.json', '{}')
    const [bad, gone] = [repo.path('bad.json'), repo.path('gone.json')]
    const read = readPulls([gone, bad])
    expect(read.listings).toBeUndefined()
    expect(read.missing).toBe(true)
    expect(read.problems.map((p) => p.slug)).toEqual([gone, bad])
  })

  it('concatenates good files in argument order', () => {
    const [a, b] = [listing({ company: 'A' }), listing({ company: 'B' })]
    repo.write('a.json', JSON.stringify([a]))
    repo.write('b.json', JSON.stringify([b]))
    const read = readPulls([repo.path('b.json'), repo.path('a.json')])
    expect(read.problems).toEqual([])
    expect(read.listings).toEqual([b, a])
  })

  it('round-trips through savePull', () => {
    const listings = [listing({ posted: '2026-10-20', workMode: 'hybrid', stack: ['React'] })]
    expect(savePull(repo.path('out.json'), listings)).toEqual([])
    expect(readPulls([repo.path('out.json')]).listings).toEqual(listings)
  })

  it('takes a saved listing posted on an ISO day, or undated', () => {
    expect(readOne([{ ...card, posted: '2026-10-20' }]).problems).toEqual([])
    expect(readOne([card]).problems).toEqual([])
  })

  it('refuses a saved listing whose posted is not an ISO day, since expiry could not be judged', () => {
    const { problems, listings } = readOne([{ ...card, posted: '2026-10-20T09:00:00Z' }])
    expect(listings).toBeUndefined()
    expect(problems[0]?.message).toContain('0.posted')
  })

  it('takes a saved listing with a known work mode, or none, as pulls before work mode had', () => {
    for (const workMode of ['remote', 'hybrid', 'onsite'])
      expect(readOne([{ ...card, workMode }]).problems).toEqual([])
    expect(readOne([{ ...card, remote: true }]).problems).toEqual([])
  })

  it('refuses any other work mode, naming the entry', () => {
    const entries = [card, card, { ...card, workMode: 'Hybrid' }]
    expect(readOne(entries).problems[0]?.message).toContain('2.workMode')
    expect(readOne([{ ...card, workMode: true }]).listings).toBeUndefined()
  })
})

describe('savePull and saveShortlist', () => {
  let repo: TempRepo
  beforeEach(() => {
    repo = tempRepo()
  })
  afterEach(() => repo.dispose())

  it('return a Problem rather than throw when the folder cannot be written', () => {
    repo.write('blocker', 'a file, not a folder')
    const out = repo.path('blocker/out.json')
    const pull = savePull(out, [])
    expect(pull).toHaveLength(1)
    expect(pull[0]?.slug).toBe(out)
    expect(pull[0]?.message).toMatch(/^could not be written: ENOTDIR/)
    expect(saveShortlist(out, { today, kept: [], dropped: [] })[0]?.message).toMatch(
      /^could not be written: ENOTDIR/,
    )
  })

  it('saves the shortlist as indented JSON', () => {
    const out = repo.path('shortlist.json')
    expect(saveShortlist(out, { today, kept: [], dropped: [] })).toEqual([])
    expect(JSON.parse(repo.read('shortlist.json'))).toEqual({ today, kept: [], dropped: [] })
  })
})

describe('shortlistLine', () => {
  const line = (over: Partial<Listing>) => {
    const [kept] = shortlist([listing(over)], stubDiscovery(), today).kept
    if (!kept) throw new Error('not kept')
    return shortlistLine(kept)
  }

  it('shows the work mode when the board gave one', () => {
    expect(line({ remote: false, workMode: 'hybrid' }).split(' | ')).toContain('hybrid')
    expect(line({ remote: true, workMode: 'remote' }).split(' | ')).toContain('remote')
    expect(line({ remote: false, workMode: 'onsite' }).split(' | ')).toContain('onsite')
  })

  it('falls back to remote from the boolean when there is no work mode', () => {
    expect(line({ board: 'whatruns', remote: true }).split(' | ')).toContain('remote')
    expect(line({ board: 'whatruns', remote: false }).split(' | ')).not.toContain('remote')
  })

  it('prints the whole line in its usual order', () => {
    expect(
      line({
        posted: '2026-10-20',
        location: 'London',
        remote: false,
        workMode: 'hybrid',
        pay: '£90k',
      }),
    ).toBe(
      '[rocketship] | 2026-10-20 | Larkspur Freight: Frontend Engineer | London | hybrid | £90k | new',
    )
  })

  it('carries the work mode on kept listings', () => {
    const [kept] = shortlist([listing({ workMode: 'hybrid' })], stubDiscovery(), today).kept
    expect(kept?.workMode).toBe('hybrid')
  })
})
