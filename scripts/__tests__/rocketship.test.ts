import { describe, expect, it } from 'vitest'
import { rocketshipBoard } from '../lib/boards/rocketship.ts'
import { fakeFetch, fixture, html, json, search, sleep } from './board-fakes.ts'
import { personaRules } from './temp-repo.ts'

describe('rocketship', () => {
  const index = fixture('rocketship-index.html')
  const page = JSON.parse(fixture('rocketship-page.json'))
  const empty = { pageProps: { initialJobOpenings: [], initialTotalJobCount: 6 } }
  // The build id in the recorded index page. A data request under any other id gets the
  // index page back, which is not JSON, so the pull fails.
  const isData = (u: URL) => u.pathname.startsWith('/_next/data/build-0000-fixture01/')
  const pageOf = (u: URL) => Number(u.searchParams.get('page'))
  const board = (fetch: (url: string) => Promise<Response>, searchTitles = ['Frontend Engineer']) =>
    rocketshipBoard({ fetch, sleep, search, searchTitles })

  it('throws when the jobs page carries no build id', async () => {
    const { fetch } = fakeFetch(() => html('<html><body>no data</body></html>'))
    await expect(board(fetch).pull()).rejects.toThrow(/build id/)
  })

  it('stops a search at a page that is not OK', async () => {
    const { fetch, urls } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      return pageOf(u) === 1 ? json(page) : new Response('', { status: 500 })
    })
    const listings = await board(fetch).pull()
    expect(listings).toHaveLength(6)
    expect(urls.filter(isData).map(pageOf)).toEqual([1, 2])
  })

  it('stops a search at an empty page', async () => {
    const { fetch, urls } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      return pageOf(u) === 1 ? json(page) : json(empty)
    })
    expect(await board(fetch).pull()).toHaveLength(6)
    expect(urls.filter(isData).map(pageOf)).toEqual([1, 2])
  })

  it('stops a search when a page repeats listings already pulled by that search', async () => {
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? json(page) : html(index)))
    expect(await board(fetch).pull()).toHaveLength(6)
    expect(urls.filter(isData).map(pageOf)).toEqual([1, 2])
  })

  it('retries a page answered with HTML instead of JSON', async () => {
    let failed = false
    const { fetch } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      if (failed || pageOf(u) !== 1) return json(page)
      failed = true
      return html('<html>not JSON</html>')
    })
    expect(await board(fetch).pull()).toHaveLength(6)
  })

  it('retries a page whose fetch throws, then takes the answer', async () => {
    let failed = false
    const { fetch } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      if (failed) return json(page)
      failed = true
      throw new Error('ECONNRESET')
    })
    expect(await board(fetch).pull()).toHaveLength(6)
  })

  it('throws after four failed attempts at one page, naming the URL', async () => {
    const { fetch, urls } = fakeFetch((u) =>
      isData(u) ? html('<html>not JSON</html>') : html(index),
    )
    await expect(board(fetch).pull()).rejects.toThrow(
      /Rocketship failed 4 times: https:\/\/www\.remoterocketship\.com\/_next\/data\/.*page=1/,
    )
    expect(urls.filter(isData)).toHaveLength(4)
  })

  it('pauses through the injected sleep, longer after each failed attempt', async () => {
    let failures = 0
    const pauses: number[] = []
    const { fetch } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      if (failures === 3) return json(page)
      failures += 1
      return html('<html>not JSON</html>')
    })
    const sleep = (ms: number) => {
      pauses.push(ms)
      return Promise.resolve()
    }
    await rocketshipBoard({ fetch, sleep, search, searchTitles: ['Frontend Engineer'] }).pull()
    expect(pauses).toEqual([1500, 3000, 4500, 200])
  })

  it('does not retry a page that is not OK, and runs the remaining searches', async () => {
    const { fetch, urls } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      return u.searchParams.get('jobTitle') === 'Missing Title'
        ? new Response('', { status: 404 })
        : json(page)
    })
    const listings = await board(fetch, ['Missing Title', 'Frontend Engineer']).pull()
    expect(listings).toHaveLength(6)
    const searches = urls.filter(isData).map((u) => u.searchParams.get('jobTitle'))
    expect(searches).toEqual(['Missing Title', 'Frontend Engineer', 'Frontend Engineer'])
  })

  it('warns when a search fails on its first page, and still returns the other searches', async () => {
    const lines: string[] = []
    const { fetch } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      return u.searchParams.get('jobTitle') === 'Missing Title'
        ? new Response('', { status: 404 })
        : json(page)
    })
    const listings = await rocketshipBoard({
      fetch,
      search,
      sleep,
      log: (line) => lines.push(line),
      searchTitles: ['Missing Title', 'Frontend Engineer'],
    }).pull()
    expect(listings).toHaveLength(6)
    expect(lines.filter((l) => l.startsWith('warning:'))).toEqual([
      expect.stringMatching(/^warning: .*"?Missing Title"?.*404/),
    ])
  })

  it('logs a later page that is not OK as a stop, not a warning', async () => {
    const lines: string[] = []
    const { fetch } = fakeFetch((u) => {
      if (!isData(u)) return html(index)
      return pageOf(u) === 1 ? json(page) : new Response('', { status: 500 })
    })
    await rocketshipBoard({
      fetch,
      search,
      sleep,
      log: (line) => lines.push(line),
      searchTitles: ['Frontend Engineer'],
    }).pull()
    expect(lines).toContain('Frontend Engineer: stopped at page 2 (HTTP 500)')
    expect(lines.filter((l) => l.startsWith('warning:'))).toEqual([])
  })

  it('searches only titles the board has a page for', () => {
    const titles = personaRules().discovery.search_titles
    expect(titles).toContain('Python Engineer')
    expect(titles).not.toContain('Python Developer')
  })

  it('searches every search title with the persona search filters', async () => {
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? json(empty) : html(index)))
    await board(fetch, ['Frontend Engineer', 'Product Engineer']).pull()
    const searches = urls.filter(isData).map((u) => u.searchParams.get('jobTitle'))
    expect(searches).toEqual(['Frontend Engineer', 'Product Engineer'])
    const first = urls.filter(isData)[0]
    expect(Object.fromEntries(first?.searchParams ?? [])).toEqual({
      page: '1',
      sort: 'DateAdded',
      locations: 'United States',
      locationCity: 'Austin',
      showHybridJobs: 'true',
      seniority: 'mid,senior',
      employmentType: 'full-time',
      techStack: 'Python,Go,PostgreSQL',
      jobTitle: 'Frontend Engineer',
    })
  })

  // Spelled out in full to pin the exact parameters and order the site is known to answer.
  it('encodes the live search preferences as the site query string', async () => {
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? json(empty) : html(index)))
    await board(fetch).pull()
    expect(urls.filter(isData)[0]?.search).toBe(
      '?page=1&sort=DateAdded&locations=United+States&seniority=mid%2Csenior&techStack=Python%2CGo%2CPostgreSQL&showHybridJobs=true&locationCity=Austin&employmentType=full-time&jobTitle=Frontend+Engineer',
    )
  })

  it('builds its query from the search preferences it is given', async () => {
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? json(empty) : html(index)))
    const changed = {
      ...search,
      city: 'Denver',
      stack: [...search.stack, 'Redis'],
      hybrid: false,
    }
    await rocketshipBoard({
      fetch,
      sleep,
      search: changed,
      searchTitles: ['Frontend Engineer'],
    }).pull()
    expect(Object.fromEntries(urls.filter(isData)[0]?.searchParams ?? [])).toMatchObject({
      locationCity: 'Denver',
      techStack: 'Python,Go,PostgreSQL,Redis',
      showHybridJobs: 'false',
    })
  })

  it('keeps one listing per company and job slug across searches', async () => {
    const { fetch } = fakeFetch((u) => (isData(u) ? json(page) : html(index)))
    const listings = await board(fetch, ['Frontend Engineer', 'Product Engineer']).pull()
    expect(listings).toHaveLength(6)
  })

  it('maps an onsite card to its work mode, and leaves an unknown one unset', async () => {
    const [first, second, ...rest] = page.pageProps.initialJobOpenings
    const cards = [
      { ...first, locationType: 'onsite' },
      { ...second, locationType: 'constructor' },
      ...rest,
    ]
    const changed = { pageProps: { ...page.pageProps, initialJobOpenings: cards } }
    const { fetch } = fakeFetch((u) => (isData(u) ? json(changed) : html(index)))
    const listings = await board(fetch).pull()
    expect(listings).toHaveLength(6)
    expect(listings[0]).toMatchObject({ remote: false, workMode: 'onsite' })
    expect(listings[1]?.remote).toBe(false)
    expect(listings[1]).not.toHaveProperty('workMode')
  })

  it('maps every field, leaving absent fields absent', async () => {
    const { fetch } = fakeFetch((u) => (isData(u) ? json(page) : html(index)))
    const listings = await board(fetch).pull()
    const by = (company: string) => listings.find((l) => l.company === company)
    expect(by('Quillmark')).toEqual({
      board: 'rocketship',
      company: 'Quillmark',
      title: 'Backend Developer',
      url: 'https://www.remoterocketship.com/gb/company/quillmark/jobs/backend-developer-remote/',
      applyUrl: 'https://careers.quillmark.example.com/jobs/1001-backend-developer',
      remote: true,
      workMode: 'remote',
      posted: '2026-10-25',
      level: 'mid/senior',
      stack: ['Go', 'PostgreSQL', 'Redis'],
      summary: expect.stringMatching(/^Backend Developer building order-routing services/),
    })
    expect(by('Fernbrook Labs')).toMatchObject({
      location: 'Canada, United States',
      remote: true,
    })
    expect(by('Pinewick')?.pay).toBe('£80,000 - £125,000 per year')
    expect(by('Thistlegate')).toMatchObject({
      location: 'Lisbon',
      remote: false,
      workMode: 'hybrid',
    })
    expect(by('Dunmere')?.languages).toEqual(['es'])
    expect(by('Oakhollow')?.level).toBe('senior/lead')
  })
})
