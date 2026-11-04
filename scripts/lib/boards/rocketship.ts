// Remote Rocketship as a job board. The site serves each results page as Next.js
// data under a build id that rotates on deploys, so the id is read from the live
// page first. A logged-out visitor gets the same first page back for every page
// number, so a search stops as soon as a page adds nothing that search has not
// already returned. An empty page, one answered with an error status, or one whose
// JSON lacks the expected envelope ends the search too, without a retry, since the board
// answers 404 to a title it has no page for and a reshaped payload will not fix itself
// on a second request. A page that fails to connect or is not JSON is retried with a growing pause,
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
// Only the envelope is checked; the cards stay unknown until each is parsed on its own.
type Page = { openings: unknown[]; total: number }
type Stop = { status: number } | { unexpected: true }
type Answer = { page: Page } | Stop

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
const isString = (x: unknown): x is string => typeof x === 'string'
const isStringList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isString)

const toPage = (body: unknown): Page | undefined => {
  if (!isRecord(body) || !isRecord(body.pageProps)) return undefined
  const { initialJobOpenings: openings, initialTotalJobCount: total } = body.pageProps
  return Array.isArray(openings) && typeof total === 'number' ? { openings, total } : undefined
}

// Optional fields that are odd fall back to absent, so one strange detail does not cost
// the listing; only what a listing cannot do without makes a card invalid.
const toCard = (x: unknown): Card | undefined => {
  if (!isRecord(x) || !isRecord(x.company)) return undefined
  const { slug, created_at, roleTitle, url, locationType } = x
  const { slug: companySlug, name } = x.company
  if (
    !isString(slug) ||
    !isString(created_at) ||
    !isString(roleTitle) ||
    !isString(url) ||
    !isString(locationType) ||
    !isString(companySlug) ||
    !isString(name)
  )
    return undefined
  const salary = isRecord(x.salaryRange) ? x.salaryRange.salaryHumanReadableText : undefined
  return {
    slug,
    created_at,
    roleTitle,
    url,
    company: { slug: companySlug, name },
    locationCountries: isStringList(x.locationCountries) ? x.locationCountries : null,
    locationCity: isString(x.locationCity) ? x.locationCity : null,
    locationType,
    salaryRange: isString(salary) ? { salaryHumanReadableText: salary } : null,
    isJunior: x.isJunior === true,
    isMidLevel: x.isMidLevel === true,
    isSenior: x.isSenior === true,
    isLead: x.isLead === true,
    requiredLanguages: isStringList(x.requiredLanguages) ? x.requiredLanguages : [],
    techStack: isStringList(x.techStack) ? x.techStack : [],
    twoLineJobDescriptionSummary: isString(x.twoLineJobDescriptionSummary)
      ? x.twoLineJobDescriptionSummary
      : '',
  }
}

// The levels the site filters on; docs/boards/rocketship.md lists the same ones, and a test
// holds the two together. The site answers any other word with every listing, so the
// search has to say so itself.
export const ROCKETSHIP_SENIORITY = ['entry-level', 'junior', 'mid-level', 'senior', 'expert']

const quoted = (words: string[]): string => {
  const marked = words.map((w) => `"${w}"`)
  return marked.length < 2
    ? marked.join('')
    : `${marked.slice(0, -1).join(', ')} and ${marked.at(-1)}`
}

// Checked here rather than in the schema because the search is shared by every board and
// the board is named only when the pull runs.
const seniorityWarning = (seniority: string[]): string | undefined => {
  const unknown = seniority.filter((x) => !ROCKETSHIP_SENIORITY.includes(x))
  if (unknown.length === 0) return undefined
  const [one, many] = unknown.length === 1 ? ['is not a level', 'it'] : ['are not levels', 'them']
  return `warning: profile/search.yaml seniority ${quoted(unknown)} ${one} Remote Rocketship knows, so it ignores ${many} and the search loses that filter; it takes ${ROCKETSHIP_SENIORITY.join(', ')}`
}

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
const stopNote = (title: string, page: number, stop: Stop): string => {
  const reason = 'status' in stop ? `HTTP ${stop.status}` : 'unexpected shape'
  return page === 1
    ? `warning: "${title}" returned nothing (${reason}); the title may not exist on Rocketship`
    : `${title}: stopped at page ${page} (${reason})`
}

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
        .then(async (r): Promise<Answer> => {
          if (!r.ok) return { status: r.status }
          // Valid JSON of the wrong shape will not change on a retry, unlike a dropped connection.
          const page = toPage(await r.json())
          return page ? { page } : { unexpected: true }
        })
        .catch(() => undefined)
      if (answer) return answer
      if (attempt < ATTEMPTS) await sleep(RETRY_MS * attempt)
    }
    throw new Error(`Rocketship failed ${ATTEMPTS} times: ${url}`)
  }

  // Skipped cards are left out of the repeat check; a page with no valid card left ends the
  // search like an empty one.
  const validCards = ({ openings }: Page, where: string): Card[] => {
    const cards = openings.flatMap((x) => toCard(x) ?? [])
    if (cards.length < openings.length)
      log?.(`${where}: skipped ${openings.length - cards.length} malformed cards`)
    return cards
  }

  const search = async (buildId: string, title: string, seen: Map<string, Listing>) => {
    const query = new URLSearchParams({ ...filters(preferences), jobTitle: title })
    const inSearch = new Set<string>()
    for (let page = 1; page <= PAGE_CAP; page++) {
      const url = `${SITE}/_next/data/${buildId}/gb/remote-jobs.json?page=${page}&${query}`
      const answer = await getPage(url)
      if (!('page' in answer)) {
        log?.(stopNote(title, page, answer))
        return
      }
      if (page === 1) log?.(`${title}: ${answer.page.total} listed`)
      const jobs = validCards(answer.page, `${title}, page ${page}`)
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
      const warning = seniorityWarning(preferences.seniority)
      if (warning) log?.(warning)
      const buildId = await readBuildId()
      const seen = new Map<string, Listing>()
      for (const title of searchTitles) await search(buildId, title, seen)
      return [...seen.values()]
    },
  }
}
