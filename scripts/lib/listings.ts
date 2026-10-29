// The shape a job board pull produces and the shortlist consumes, with the reading and
// saving of the files between them, kept in one place so the two stages cannot drift apart.
import { z } from 'zod'
import { daysBetween, isDay } from './dates.ts'
import { type Discovery, type ListingMatch, normaliseCompany, normaliseTitle } from './discovery.ts'
import type { Problem } from './problem.ts'
import { fileProblem, readFile, writeProblem } from './read-file.ts'

const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const
export type WorkMode = (typeof WORK_MODES)[number]
export const isWorkMode = (x: unknown): x is WorkMode => WORK_MODES.some((m) => m === x)

export type Listing = {
  board: string
  company: string
  title: string
  url: string
  location?: string
  // True only for a fully remote role. A board that tells hybrid from on-site sets
  // workMode as well; one that knows only this flag leaves workMode unset.
  remote?: boolean
  workMode?: WorkMode
  // An ISO day, so dedupe and the sort can compare it as a string.
  posted?: string
  pay?: string
  applyUrl?: string
  level?: string
  languages?: string[]
  stack?: string[]
  summary?: string
  // The applicant tracking system the board found the listing on.
  via?: string
}

// A saved pull is read back from disk, so its entries are checked against Listing before
// the shortlist trusts them; keep the schema in step with the type, since a field left out
// of it is dropped on read.
// A posted date that is not an ISO day is refused, since expiry could not be judged, and
// so is a work mode outside the three, since the shortlist line would print it as one.
const ListingSchema = z.object({
  board: z.string(),
  company: z.string(),
  title: z.string(),
  url: z.string(),
  location: z.string().exactOptional(),
  remote: z.boolean().exactOptional(),
  workMode: z.enum(WORK_MODES).exactOptional(),
  posted: z.string().refine(isDay, 'not an ISO day').exactOptional(),
  pay: z.string().exactOptional(),
  applyUrl: z.string().exactOptional(),
  level: z.string().exactOptional(),
  languages: z.array(z.string()).exactOptional(),
  stack: z.array(z.string()).exactOptional(),
  summary: z.string().exactOptional(),
  via: z.string().exactOptional(),
}) satisfies z.ZodType<Listing>

const PullSchema = z.array(ListingSchema)

export type PullRead = { listings: Listing[] | undefined; problems: Problem[]; missing: boolean }

// Every path is read, so one run names every bad file; the listings come back only when all
// of them read, because a shortlist made from some of the pulls would look like a whole one.
export const readPulls = (paths: string[]): PullRead => {
  const reads = paths.map((path) => ({
    path,
    read: readFile(path, (text) => PullSchema.parse(JSON.parse(text))),
  }))
  const problems = reads.flatMap(({ path, read }) => fileProblem(path, read))
  const missing = reads.some(({ read }) => read.missing)
  if (problems.length > 0) return { listings: undefined, problems, missing }
  return { listings: reads.flatMap(({ read }) => read.data ?? []), problems, missing }
}

export const savePull = (path: string, listings: Listing[]): Problem[] =>
  writeProblem(path, path, JSON.stringify(listings, null, 2))

export const saveShortlist = (
  path: string,
  result: { today: string; kept: Shortlisted[]; dropped: Dropped[] },
): Problem[] => writeProblem(path, path, JSON.stringify(result, null, 2))

export type JobBoard = { name: string; pull: () => Promise<Listing[]> }

// What a board is given from outside, passed in so a test can run a pull against
// recorded pages with no network and no waiting.
export type BoardDeps = {
  fetch: (url: string, init?: { headers: Record<string, string> }) => Promise<Response>
  sleep: (ms: number) => Promise<void>
  log?: (line: string) => void
}

export type Shortlisted = Listing & { match: ListingMatch; boards: string[]; listings: number }
export type Dropped = { listing: Listing; reason: 'title' | 'expired' }

type Group = { kept: Listing; boards: string[]; listings: number; posted: string | undefined }

const fieldCount = (l: Listing): number => Object.values(l).filter((v) => v !== undefined).length

// Whoever reads the shortlist sees one listing per role, so the duplicate kept is
// the one that says most about it; among equals the latest posted, then the one pulled first.
const richer = (a: Listing, b: Listing): boolean => {
  const [fa, fb] = [fieldCount(a), fieldCount(b)]
  return fa > fb || (fa === fb && (a.posted ?? '') > (b.posted ?? ''))
}

const dedupe = (listings: Listing[]): Group[] => {
  const groups = new Map<string, Group>()
  for (const l of listings) {
    const key = `${normaliseCompany(l.company)}\n${normaliseTitle(l.title)}`
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { kept: l, boards: [l.board], listings: 1, posted: l.posted })
      continue
    }
    g.listings += 1
    if (!g.boards.includes(l.board)) g.boards.push(l.board)
    if (richer(l, g.kept)) g.kept = l
    if (l.posted !== undefined && (g.posted === undefined || l.posted > g.posted))
      g.posted = l.posted
  }
  return [...groups.values()]
}

export const shortlist = (
  listings: Listing[],
  discovery: Discovery,
  today: string,
): { kept: Shortlisted[]; dropped: Dropped[] } => {
  const kept: Shortlisted[] = []
  const dropped: Dropped[] = []
  for (const g of dedupe(listings)) {
    const listing: Listing = g.posted === undefined ? g.kept : { ...g.kept, posted: g.posted }
    if (!discovery.qualifies(listing.title)) {
      dropped.push({ listing, reason: 'title' })
      continue
    }
    if (listing.posted !== undefined && daysBetween(listing.posted, today) > discovery.freshDays) {
      dropped.push({ listing, reason: 'expired' })
      continue
    }
    kept.push({
      ...listing,
      match: discovery.match(listing.company, listing.title),
      boards: g.boards,
      listings: g.listings,
    })
  }
  return { kept: kept.sort(newestFirst), dropped }
}

// Undated listings sort after every dated one: an empty string compares below any ISO day.
const newestFirst = (a: Shortlisted, b: Shortlisted): number =>
  (b.posted ?? '').localeCompare(a.posted ?? '') ||
  a.company.localeCompare(b.company, 'en') ||
  a.title.localeCompare(b.title, 'en')

const matchText = (m: ListingMatch): string => {
  if (m.kind === 'tracked') return `tracked: ${m.role.slug} (${m.role.status})`
  if (m.kind === 'company') return `company: ${m.roles.map((r) => r.slug).join(', ')}`
  return 'new'
}

export const shortlistLine = (l: Shortlisted): string =>
  [
    `[${l.boards.join('+')}]`,
    l.posted ?? 'undated',
    `${l.company}: ${l.title}`,
    l.location,
    l.workMode ?? (l.remote ? 'remote' : undefined),
    l.pay,
    l.level,
    l.stack?.slice(0, 5).join(', '),
    matchText(l.match),
  ]
    .filter((x) => x)
    .join(' | ')
