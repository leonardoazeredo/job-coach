// WhatRuns as a job board. The API can fail to connect or answer with an error page or
// HTML instead of JSON, so each page is retried with a growing pause before the whole
// pull fails. Only locations are sent, so the seniority, stack, employment type and
// hybrid preferences are ignored.
import type { BoardDeps, JobBoard, Listing } from '../listings.ts'
import type { SearchPreferences } from '../schema.ts'

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
const ATTEMPTS = 4
const RETRY_MS = 1500
// Pause between the pages of one location, so the API is not hit in a burst.
const PAUSE_MS = 200

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
  fetch,
  sleep,
  log,
  search,
}: BoardDeps & { search: SearchPreferences }): JobBoard => {
  const getPage = async (url: string): Promise<Page> => {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const body: unknown = await fetch(url)
        .then((r) => r.json())
        .catch(() => undefined)
      if (isPage(body)) return body
      if (attempt < ATTEMPTS) await sleep(RETRY_MS * attempt)
    }
    throw new Error(`WhatRuns failed ${ATTEMPTS} times: ${url}`)
  }

  const pullLocation = async (location: string, seen: Map<Card['id'], Listing>) => {
    let pages = 1
    for (let page = 1; page <= pages; page++) {
      const p = await getPage(`${API}?page=${page}&location=${encodeURIComponent(location)}`)
      pages = p.totalPages
      for (const j of p.data) seen.set(j.id, toListing(j))
      if (page === 1 || page % 10 === 0)
        log?.(`${location}: page ${page}/${pages} (${p.total} listings)`)
      if (page < pages) await sleep(PAUSE_MS)
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
