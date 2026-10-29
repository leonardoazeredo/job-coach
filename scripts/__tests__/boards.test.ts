import { describe, expect, it } from 'vitest'
import { boardFor } from '../lib/boards/index.ts'
import { fakeFetch, fixture, html, json, sleep } from './board-fakes.ts'
import { personaRules } from './temp-repo.ts'

const rules = personaRules()
const empty = { pageProps: { initialJobOpenings: [], initialTotalJobCount: 0 } }
const isData = (u: URL) => u.pathname.startsWith('/_next/data/')
const index = fixture('rocketship-index.html')

describe('boardFor', () => {
  it('gives Rocketship a search for every search title and title expansion', async () => {
    const { fetch, urls } = fakeFetch((u) => (isData(u) ? json(empty) : html(index)))
    const entry = boardFor('rocketship', rules, { fetch, sleep })
    await entry?.board.pull()
    const { search_titles, title_expansion } = rules.discovery
    const titles = urls.filter(isData).map((u) => u.searchParams.get('jobTitle'))
    expect(titles).toEqual([...search_titles, ...title_expansion])
  })

  it('gives WhatRuns the search preferences', async () => {
    const { fetch, urls } = fakeFetch(() => json({ data: [], total: 0, page: 1, totalPages: 1 }))
    const entry = boardFor('whatruns', rules, { fetch, sleep })
    await entry?.board.pull()
    const locations = urls.map((u) => u.searchParams.get('location'))
    expect(locations).toEqual(expect.arrayContaining(rules.discovery.search.regions))
  })

  it('gives nothing for a name it does not know', () => {
    const { fetch } = fakeFetch(() => undefined)
    expect(boardFor('nowhere', rules, { fetch, sleep })).toBeUndefined()
  })

  it('gives each board its own expected run time', () => {
    const { fetch } = fakeFetch(() => undefined)
    const deps = { fetch, sleep }
    expect(boardFor('whatruns', rules, deps)?.expected).toBe('a few minutes')
    expect(boardFor('rocketship', rules, deps)?.expected).toBe('under a minute')
  })
})
