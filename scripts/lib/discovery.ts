// What discovery asks of the pipeline: is a pulled listing already tracked, and is
// its title worth triaging. Answered here, over the records the workspace loads for
// check.ts, so a listing matches the roles the checker sees.
import type { Problem } from './problem.ts'
import type { LoadedRole } from './role-folder.ts'
import type { Rules } from './schema.ts'

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

const FRONTEND =
  /front[\s-]?end|\bui\b|web (engineer|developer|platform)|react|javascript|typescript|design system/i
const EXCLUDED =
  /intern\b|internship|graduate|new grad|junior|apprentice|working student|werkstudent|back[\s-]?end|mobile|\bios\b|android|recruit|sales|marketing|designer\b|manager|director|head of|qa\b|test/i
// Full-stack is the one exclusion that an explicit front-end term or an expansion title
// overrides. Language and framework names describe the stack, not the frontend share of the
// role, so FRONT_END leaves them out.
const FULL_STACK = /full[\s-]?stack|fullstack/i
const FRONT_END = /front[\s-]?end/i

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Each gap between the words of an expansion title may hold one extra word, so "Founding
// Engineer" also admits "Founding Frontend Engineer". A last word "Engineer" also admits
// "Engineering", because job ads say "Product Engineering Lead" for "Product Engineer". Only
// "Engineer" gets it: appending "ing" to other "-er" words makes non-words ("Developering").
// EXCLUDED is the only guard on the "-ing" form: "Product Engineering Manager" fails there.
const expansionPattern = (title: string): RegExp => {
  const words = title.trim().split(/[\s-]+/)
  const last = words.length - 1
  const body = words
    .map((w, i) =>
      i === last && /^engineer$/i.test(w) ? `${escapeRegex(w)}(?:ing)?` : escapeRegex(w),
    )
    .join('[\\s-]+(?:\\w+[\\s-]+)?')
  return new RegExp(`\\b${body}\\b`, 'i')
}

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
  const expansion = rules.discovery.title_expansion.map(expansionPattern)

  const match = (company: string, title: string): ListingMatch => {
    const c = normaliseCompany(company)
    const t = normaliseTitle(title)
    const same = tracked.filter((r) => overlaps(c, r.company, (x, y) => x.startsWith(y)))
    const exact = same.find((r) => overlaps(t, r.title, (x, y) => x.includes(y)))
    if (exact) return { kind: 'tracked', role: exact.role }
    if (same.length > 0) return { kind: 'company', roles: same.map((r) => r.role) }
    return { kind: 'new' }
  }

  const qualifies = (title: string): boolean => {
    const expanded = expansion.some((p) => p.test(title))
    return (
      (FRONTEND.test(title) || expanded) &&
      !EXCLUDED.test(title) &&
      (!FULL_STACK.test(title) || FRONT_END.test(title) || expanded)
    )
  }

  return { problems, match, qualifies, freshDays: rules.discovery.fresh_days }
}
