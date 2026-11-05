// What discovery asks of the pipeline: is a pulled listing already tracked, and is
// its title worth triaging. Answered here, over the records the workspace loads for
// check.ts, so a listing matches the roles the checker sees.
import type { Problem } from './problem.ts'
import type { LoadedRole } from './role-folder.ts'
import type { Rules } from './schema.ts'
import { qualifyingTitle } from './title-gate.ts'

export type TrackedRole = { slug: string; status: string }

export type ListingMatch =
  | { kind: 'tracked'; role: TrackedRole }
  | { kind: 'company'; roles: TrackedRole[] }
  | { kind: 'new' }

export type Discovery = {
  // Roles whose record could not be read: a listing for one of them would come
  // back as new, so callers must show these.
  problems: Problem[]
  match: (company: string, title: string) => ListingMatch
  qualifies: (title: string) => boolean
  // Carried here from rules.yaml so the workspace stays the only reader of that file.
  freshDays: number
}

// Legal forms, domain endings, generic words (Labs, Group, Software) and bracketed
// notes vary between job boards and records ("Acme Bank Ltd", "Acme.io"),
// so they are dropped before comparing.
export const normaliseCompany = (s: string): string =>
  s
    .toLowerCase()
    .replace(
      /\(.*?\)|\b(inc|ltd|limited|llc|gmbh|ai|io|labs|group|technologies|software|careers?)\b|\.(ai|io|com|to)\b/g,
      '',
    )
    .replace(/[^a-z0-9]/g, '')

export const normaliseTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Either side may carry extra words ("Acme" against "Acme Bank"), so the test
// runs both ways.
const overlaps = (a: string, b: string, test: (x: string, y: string) => boolean): boolean =>
  a !== '' && b !== '' && (test(a, b) || test(b, a))

export const discovery = (roles: LoadedRole[], rules: Rules): Discovery => {
  const problems: Problem[] = []
  const tracked: { role: TrackedRole; company: string; title: string }[] = []
  for (const r of roles) {
    if (!r.record) {
      problems.push(...r.problems)
      continue
    }
    tracked.push({
      role: { slug: r.slug, status: r.record.status },
      company: normaliseCompany(r.record.company),
      title: normaliseTitle(r.record.job_title ?? ''),
    })
  }

  const match = (company: string, title: string): ListingMatch => {
    const c = normaliseCompany(company)
    const t = normaliseTitle(title)
    const same = tracked.filter((r) => overlaps(c, r.company, (x, y) => x.startsWith(y)))
    const exact = same.find((r) => overlaps(t, r.title, (x, y) => x.includes(y)))
    if (exact) return { kind: 'tracked', role: exact.role }
    if (same.length > 0) return { kind: 'company', roles: same.map((r) => r.role) }
    return { kind: 'new' }
  }

  return {
    problems,
    match,
    qualifies: qualifyingTitle(rules.discovery),
    freshDays: rules.discovery.fresh_days,
  }
}
