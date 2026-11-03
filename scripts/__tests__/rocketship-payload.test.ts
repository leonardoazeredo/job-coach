import { describe, expect, it } from 'vitest'
import { rocketshipBoard } from '../lib/boards/rocketship.ts'
import { fakeFetch, fixture, html, json, search, sleep } from './board-fakes.ts'

const index = fixture('rocketship-index.html')
const page = JSON.parse(fixture('rocketship-page.json'))
const isData = (u: URL) => u.pathname.startsWith('/_next/data/build-0000-fixture01/')
const pageOf = (u: URL) => Number(u.searchParams.get('page'))

describe('rocketship payload validation', () => {
  const cards: Record<string, unknown>[] = page.pageProps.initialJobOpenings
  const withCards = (list: unknown[]) => ({
    pageProps: { ...page.pageProps, initialJobOpenings: list },
  })
  const run = async (
    answer: (u: URL) => Response,
    titles = ['Missing Title', 'Frontend Engineer'],
  ) => {
    const lines: string[] = []
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? answer(u) : html(index)))
    const listings = await rocketshipBoard({
      fetch,
      search,
      sleep,
      log: (line) => lines.push(line),
      searchTitles: titles,
    }).pull()
    return { lines, listings, urls: urls.filter(isData) }
  }
  const brokenOnFirstTitle = (body: unknown) => (u: URL) =>
    u.searchParams.get('jobTitle') === 'Missing Title' ? json(body) : json(page)

  it.each([
    ['an error object', { error: 'maintenance' }],
    ['an empty object', {}],
    ['null', null],
    ['a missing openings list', { pageProps: { initialTotalJobCount: 6 } }],
    ['a null openings list', { pageProps: { initialJobOpenings: null, initialTotalJobCount: 6 } }],
    [
      'a non-numeric total',
      { pageProps: { initialJobOpenings: cards, initialTotalJobCount: 'six' } },
    ],
    ['a null pageProps', { pageProps: null }],
  ])('warns once and keeps the other titles when page 1 is %s', async (_name, body) => {
    const { lines, listings, urls } = await run(brokenOnFirstTitle(body))
    expect(listings).toHaveLength(6)
    expect(lines.filter((l) => l.startsWith('warning:'))).toEqual([
      expect.stringMatching(/^warning: .*Missing Title.*unexpected shape/),
    ])
    expect(lines.join('\n')).not.toMatch(/HTTP/)
    // One request for the broken title: no retry.
    expect(urls.filter((u) => u.searchParams.get('jobTitle') === 'Missing Title')).toHaveLength(1)
  })

  it('stops at a later page with an invalid envelope and keeps earlier pages', async () => {
    const { lines, listings, urls } = await run(
      (u) => (pageOf(u) === 1 ? json(page) : json({ error: 'x' })),
      ['Frontend Engineer'],
    )
    expect(listings).toHaveLength(6)
    expect(lines).toContain('Frontend Engineer: stopped at page 2 (unexpected shape)')
    expect(lines.filter((l) => l.startsWith('warning:'))).toEqual([])
    expect(urls.map(pageOf)).toEqual([1, 2])
  })

  it('skips malformed cards, keeps the valid ones and logs how many were skipped', async () => {
    const [first, second, third, ...rest] = cards
    const odd = [
      first,
      { ...second, company: null },
      { ...third, roleTitle: undefined },
      null,
      'card',
      ...rest,
    ]
    const { lines, listings } = await run(() => json(withCards(odd)), ['Frontend Engineer'])
    expect(listings).toHaveLength(4)
    expect(lines).toContain('Frontend Engineer, page 1: skipped 4 malformed cards')
  })

  it('does not let skipped cards end a search early or keep it going', async () => {
    const odd = [...cards, { slug: 'broken' }]
    const { urls, listings } = await run(() => json(withCards(odd)), ['Frontend Engineer'])
    expect(listings).toHaveLength(6)
    expect(urls.map(pageOf)).toEqual([1, 2])
  })
})
