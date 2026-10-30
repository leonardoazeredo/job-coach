// Remote Rocketship as a job board. The site serves each results page as Next.js
// data under a build id that rotates on deploys, so the id is read from the live
// page first. A logged-out visitor gets the same first page back for every page
// number, so a search stops as soon as a page adds nothing that search has not
// already returned. An empty page, or one answered with an error status, ends the
// search too, without a retry, since the board answers 404 to a title it has no page
// for. A page that fails to connect or is not JSON is retried with a growing pause,
// and fails the whole pull only once every attempt has failed.
import { type BoardDeps, isWorkMode, type JobBoard, type Listing } from '../listings.ts'
import type { SearchPreferences } from '../schema.ts'

// Only the fields read below; the payload carries many more.
type Card = {
  slug: string
  created_at: string
  roleTitle: string
  url: string
  company: { slug: string; name: string }
  locationCountries: string[] | null
  locationCity: string | null
  locationType: string
  salaryRange: { salaryHumanReadableText: string } | null
  isJunior: boolean
  isMidLevel: boolean
  isSenior: boolean
  isLead: boolean
  requiredLanguages: string[]
  techStack: string[]
  twoLineJobDescriptionSummary: string
}
type Page = { pageProps: { initialJobOpenings: Card[]; initialTotalJobCount: number } }
type Answer = { page: Page } | { status: number }

const SITE = 'https://www.remoterocketship.com'
const HEADERS = { 'user-agent': 'Mozilla/5.0' }
// The search preferences as the site's query parameters, with the sort order fixed here.
// Only the country goes in `locations`: a country search already includes worldwide-remote
// roles, `Europe` would pull in far more than a country search, and an unknown name such
// as EMEA falls back to worldwide-only results (docs/boards/rocketship.md).
// The parameters narrow the pull up front; the shortlist still applies the title and
// expiry rules to what comes back.
const filters = (search: SearchPreferences) => ({
  sort: 'DateAdded',
  locations: search.country,
  seniority: search.seniority.join(','),
  techStack: search.stack.join(','),
  showHybridJobs: String(search.hybrid),
  locationCity: search.city,
  employmentType: search.employment,
})
// A guard against runaway paging; the repeat check normally ends a search long before it.
const PAGE_CAP = 20
const ATTEMPTS = 4
const RETRY_MS = 1500
// Pause between the pages of one search, so the board is not hit in a burst.
const PAUSE_MS = 200

const keyOf = (j: Card): string => `${j.company.slug}/${j.slug}`

// A first page that fails means the title brought nothing at all, which a pull
// that carries on and exits 0 would otherwise hide among the routine stops.
const stopNote = (title: string, page: number, status: number): string =>
  page === 1
    ? `warning: "${title}" returned nothing (HTTP ${status}); the title may not exist on Rocketship`
    : `${title}: stopped at page ${page} (HTTP ${status})`

const toListing = (j: Card): Listing => {
  const listing: Listing = {
    board: 'rocketship',
    company: j.company.name,
    title: j.roleTitle,
    url: `${SITE}/gb/company/${j.company.slug}/jobs/${j.slug}/`,
    applyUrl: j.url,
    remote: j.locationType === 'remote',
    posted: j.created_at.slice(0, 10),
  }
  // A location type outside the three leaves the work mode unset rather than failing the pull.
  if (isWorkMode(j.locationType)) listing.workMode = j.locationType
  const location = [...(j.locationCountries ?? []), ...(j.locationCity ? [j.locationCity] : [])]
  if (location.length > 0) listing.location = location.join(', ')
  if (j.salaryRange) listing.pay = j.salaryRange.salaryHumanReadableText
  const level = [
    j.isJunior && 'junior',
    j.isMidLevel && 'mid',
    j.isSenior && 'senior',
    j.isLead && 'lead',
  ].filter((x): x is string => typeof x === 'string')
  if (level.length > 0) listing.level = level.join('/')
  // English is taken for granted, so only the other required languages are worth showing.
  const languages = j.requiredLanguages.filter((x) => x !== 'en')
  if (languages.length > 0) listing.languages = languages
  if (j.techStack.length > 0) listing.stack = j.techStack
  if (j.twoLineJobDescriptionSummary) listing.summary = j.twoLineJobDescriptionSummary
  return listing
}

export const rocketshipBoard = ({
  fetch,
  sleep,
  log,
  searchTitles,
  search: preferences,
}: BoardDeps & { searchTitles: string[]; search: SearchPreferences }): JobBoard => {
  const readBuildId = async (): Promise<string> => {
    const html = await (await fetch(`${SITE}/gb/remote-jobs/`, { headers: HEADERS })).text()
    const buildId = html.match(/"buildId":"([^"]+)"/)?.[1]
    if (!buildId) throw new Error('Rocketship build id not found; the page layout may have changed')
    return buildId
  }

  const getPage = async (url: string): Promise<Answer> => {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const answer = await fetch(url, { headers: HEADERS })
        .then(
          async (r): Promise<Answer> =>
            r.ok ? { page: (await r.json()) as Page } : { status: r.status },
        )
        .catch(() => undefined)
      if (answer) return answer
      if (attempt < ATTEMPTS) await sleep(RETRY_MS * attempt)
    }
    throw new Error(`Rocketship failed ${ATTEMPTS} times: ${url}`)
  }

  const search = async (buildId: string, title: string, seen: Map<string, Listing>) => {
    const query = new URLSearchParams({ ...filters(preferences), jobTitle: title })
    const inSearch = new Set<string>()
    for (let page = 1; page <= PAGE_CAP; page++) {
      const url = `${SITE}/_next/data/${buildId}/gb/remote-jobs.json?page=${page}&${query}`
      const answer = await getPage(url)
      if ('status' in answer) {
        log?.(stopNote(title, page, answer.status))
        return
      }
      const { pageProps } = answer.page
      if (page === 1) log?.(`${title}: ${pageProps.initialTotalJobCount} listed`)
      const jobs = pageProps.initialJobOpenings
      if (jobs.every((j) => inSearch.has(keyOf(j)))) return
      for (const j of jobs) {
        inSearch.add(keyOf(j))
        seen.set(keyOf(j), toListing(j))
      }
      await sleep(PAUSE_MS)
    }
  }

  return {
    name: 'rocketship',
    pull: async () => {
      const buildId = await readBuildId()
      const seen = new Map<string, Listing>()
      for (const title of searchTitles) await search(buildId, title, seen)
      return [...seen.values()]
    },
  }
}
