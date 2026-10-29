import { describe, expect, it } from 'vitest'
import { whatrunsBoard } from '../lib/boards/whatruns.ts'
import { fakeFetch, fixture, html, json, search, sleep } from './board-fakes.ts'

describe('whatruns', () => {
  const page1 = JSON.parse(fixture('whatruns-page.json'))
  const extra = {
    id: 999001,
    company: 'Marrowbrook',
    source: 'greenhouse',
    title: 'Senior Frontend Engineer',
    location: 'Austin',
    remote: false,
    applyUrl: 'https://boards.greenhouse.io/marrowbrook/jobs/1#app',
    jobUrl: 'https://boards.greenhouse.io/marrowbrook/jobs/1',
    publishedAt: '2026-10-24T09:00:00.000Z',
    compensationSummary: null,
  }
  const page2 = { data: [extra], total: 5, page: 2, totalPages: 2 }
  const pageOf = (u: URL) => Number(u.searchParams.get('page'))
  const locationOf = (u: URL) => u.searchParams.get('location')
  const byPage = (u: URL) => (pageOf(u) === 1 ? json(page1) : json(page2))

  it('pages through totalPages for each of its locations', async () => {
    const { fetch, urls } = fakeFetch(byPage)
    const listings = await whatrunsBoard({ fetch, sleep, search }).pull()
    expect(listings).toHaveLength(5)
    expect(urls.map(locationOf)).toEqual(
      ['Austin', 'United States', 'North America', 'Remote'].flatMap((l) => [l, l]),
    )
    expect(urls.map(pageOf)).toEqual([1, 2, 1, 2, 1, 2, 1, 2])
  })

  it('pulls the city, the country, then each region from the search preferences', async () => {
    const { fetch, urls } = fakeFetch(byPage)
    await whatrunsBoard({ fetch, sleep, search: { ...search, regions: ['Remote'] } }).pull()
    expect([...new Set(urls.map(locationOf))]).toEqual(['Austin', 'United States', 'Remote'])
  })

  it('retries a page that is not JSON, then takes the JSON answer', async () => {
    let failed = false
    const { fetch, urls } = fakeFetch((u) => {
      if (failed || pageOf(u) !== 1) return byPage(u)
      failed = true
      return html('<html>502 Bad Gateway</html>')
    })
    const listings = await whatrunsBoard({ fetch, sleep, search }).pull()
    expect(listings).toHaveLength(5)
    expect(urls).toHaveLength(9)
  })

  it('throws after four failed attempts at one page', async () => {
    const { fetch, urls } = fakeFetch(() => html('<html>502 Bad Gateway</html>'))
    await expect(whatrunsBoard({ fetch, sleep, search }).pull()).rejects.toThrow(/failed 4 times/)
    expect(urls).toHaveLength(4)
  })

  it('keeps one listing per id across locations', async () => {
    const { fetch } = fakeFetch(() => json({ ...page1, totalPages: 1 }))
    expect(await whatrunsBoard({ fetch, sleep, search }).pull()).toHaveLength(4)
  })

  it('maps every field, with publishedAt as an ISO day and the ATS as via', async () => {
    const { fetch } = fakeFetch(() => json({ ...page1, totalPages: 1 }))
    const listings = await whatrunsBoard({ fetch, sleep, search }).pull()
    const by = (company: string) => listings.find((l) => l.company === company)
    expect(by('Ravenmoor')).toEqual({
      board: 'whatruns',
      company: 'Ravenmoor',
      title: 'Backend Engineer',
      url: 'https://jobs.ashbyhq.com/ravenmoor/f406eef3-4008-42c2-9d56-02423dbbb6c2',
      applyUrl:
        'https://jobs.ashbyhq.com/ravenmoor/f406eef3-4008-42c2-9d56-02423dbbb6c2/application',
      location: 'Toronto',
      remote: true,
      posted: '2026-10-21',
      via: 'ashby',
    })
    expect(by('Hazelcroft')?.pay).toBe('$100K – $130K')
    expect(by('Alderwick')?.title).toBe('Senior Software Engineer')
    expect(by('Wrenfield')).toMatchObject({ remote: false, via: 'teamtailor' })
  })
})
