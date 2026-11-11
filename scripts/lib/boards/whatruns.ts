// WhatRuns as a job board. The API can fail to connect or answer with an error page or
// HTML instead of JSON; the shared page loop retries those before the whole pull fails.
// Only locations are sent, so the seniority, stack, employment type and hybrid
// preferences are ignored.
import type { Listing } from '../listings.ts'
import type { SearchPreferences } from '../schema.ts'
import type { JobBoard } from './index.ts'
import { type BoardDeps, pages } from './pull-loop.ts'

// Only the fields read below; the payload carries many more.
type Card = {
  id: string | number
  company: string
  source: string
  title: string
  location: string
  remote: boolean
  applyUrl: string
  jobUrl: string
  publishedAt: string
  compensationSummary: string | null
}
type Page = { data: Card[]; total: number; totalPages: number }

const API = 'https://jobs.whatrunsindia.com/api/jobs'
// A role is filed under its city, its country or a region, and the site does not nest
// them, so the city, the country and each region are pulled in turn. A listing filed
// under more than one is kept once, by id.
const locations = (search: SearchPreferences): string[] => [
  search.city,
  search.country,
  ...search.regions,
]

const isPage = (x: unknown): x is Page =>
  typeof x === 'object' && x !== null && 'data' in x && Array.isArray(x.data)

const toListing = (j: Card): Listing => {
  const listing: Listing = {
    board: 'whatruns',
    company: j.company.trim(),
    title: j.title.trim(),
    url: j.jobUrl,
    applyUrl: j.applyUrl,
    location: j.location,
    remote: j.remote,
    posted: j.publishedAt.slice(0, 10),
    via: j.source,
  }
  if (j.compensationSummary) listing.pay = j.compensationSummary
  return listing
}

export const whatrunsBoard = ({
  search,
  ...deps
}: BoardDeps & { search: SearchPreferences }): JobBoard => {
  const { log } = deps
  // An error page or HTML is not an answer; undefined makes the loop ask again.
  const read = async (r: Response): Promise<Page | undefined> => {
    const body: unknown = await r.json().catch(() => undefined)
    return isPage(body) ? body : undefined
  }

  const pullLocation = async (location: string, seen: Map<Card['id'], Listing>) => {
    const urlOf = (p: number) => `${API}?page=${p}&location=${encodeURIComponent(location)}`
    for await (const { page, answer } of pages(deps, 'WhatRuns', {
      urlOf,
      read,
    })) {
      for (const j of answer.data) seen.set(j.id, toListing(j))
      if (page === 1 || page % 10 === 0)
        log?.(`${location}: page ${page}/${answer.totalPages} (${answer.total} listings)`)
      // Breaking here, not after a pause, keeps the last page from being followed by one.
      if (page >= answer.totalPages) break
    }
  }

  return {
    name: 'whatruns',
    pull: async () => {
      const seen = new Map<Card['id'], Listing>()
      for (const location of locations(search)) await pullLocation(location, seen)
      return [...seen.values()]
    },
  }
}
