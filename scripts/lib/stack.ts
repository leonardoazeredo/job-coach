// What profile/stack.yaml lets the user claim. Records ask which stack section
// an item is in, by the exact name of an entry or of one technology inside it.
// CVs ask whether an item is claimable, by a looser name match that still holds
// limited items to their limit; free text is matched by whole word and case
// (docs/adr/0001-stack-limits-are-explicit.md).
import { z } from 'zod'

const str = z.string()

const LimitedItemSchema = z.object({ name: str, roles: z.array(str), claim_as: str })
const StackItemSchema = z.union([str, LimitedItemSchema])

export const StackFileSchema = z.looseObject({
  core: z.array(StackItemSchema),
  secondary: z.array(StackItemSchema),
  past: z.array(StackItemSchema),
  tools: z.array(StackItemSchema),
  do_not_claim: z.array(z.looseObject({ item: str, patterns: z.array(str).min(1) })),
})
export type StackFile = z.infer<typeof StackFileSchema>

export type Section = 'core' | 'secondary' | 'past' | 'tools'
const SECTIONS: Section[] = ['core', 'secondary', 'past', 'tools']

export type Claim =
  | { ok: true }
  | { ok: false; reason: 'not-in-stack' }
  | { ok: false; reason: 'needs-limit'; claimAs: string }

export type Catch = { item: string; pattern: string }

export type Stack = {
  sectionsOf: (item: string) => Section[]
  claim: (item: string, roleId?: string) => Claim
  covers: (keyword: string) => boolean
  breaches: (text: string) => string[]
  limitBreaches: (text: string, roleId?: string) => string[]
  problems: (historyIds: string[]) => string[]
}

// An entry such as "Make, CMake, Ninja" or "GCP (Cloud Run, GKE, BigQuery)" names
// several technologies; each named part is a token an item may match.
const tokensOf = (entry: string): string[] => {
  const tokens = new Set([bareName(entry)])
  for (const part of entry.split(/[,;:()]| \/ | with /)) {
    const token = part.trim().toLowerCase()
    if (token) tokens.add(token)
  }
  return [...tokens]
}

const bareName = (item: string): string =>
  item
    .replace(/\s*\(.*\)\s*$/, '')
    .toLowerCase()
    .trim()

const normalise = (item: string): string => bareName(item).replace(/([a-z])\d+$/, '$1')

// An exact token, a plural of one, or the head of a longer entry ("Metrics" -> "Metric tooling").
const looselyMatches = (item: string, tokens: string[]): boolean => {
  const forms = new Set([normalise(item), normalise(item).replace(/s$/, '')])
  return tokens.some((raw) => {
    const token = normalise(raw)
    return [...forms].some(
      (form) => form === token || form === token.replace(/s$/, '') || token.startsWith(`${form} `),
    )
  })
}

// The names of a limited item as stack.yaml writes them, case kept, because a
// free-text mention only counts when it matches case ("Zig" but not "zig-zag").
const namesOf = (name: string): string[] => [
  ...new Set(
    [name.replace(/\s*\(.*\)\s*$/, ''), ...name.split(/[,;:()]| \/ | with /)]
      .map((n) => n.trim())
      .filter(Boolean),
  ),
]

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Entry = {
  section: Section
  tokens: string[]
  limit: z.infer<typeof LimitedItemSchema> | undefined
}

const entriesOf = (file: StackFile): Entry[] =>
  SECTIONS.flatMap((section) =>
    file[section].map((item) =>
      typeof item === 'string'
        ? { section, tokens: tokensOf(item), limit: undefined }
        : { section, tokens: tokensOf(item.name), limit: item },
    ),
  )

const claimWith = (entries: Entry[], item: string, roleId: string | undefined): Claim => {
  const asWritten = item.trim().toLowerCase()
  if (entries.some((e) => e.limit?.claim_as.toLowerCase() === asWritten)) return { ok: true }
  const matching = entries.filter((e) => looselyMatches(item, e.tokens))
  if (matching.length === 0) return { ok: false, reason: 'not-in-stack' }
  const allowed = (e: Entry) => !e.limit || (roleId !== undefined && e.limit.roles.includes(roleId))
  if (matching.some(allowed)) return { ok: true }
  return { ok: false, reason: 'needs-limit', claimAs: matching[0]?.limit?.claim_as ?? '' }
}

// Free text has no per-item syntax to parse, so a limited item counts as
// mentioned when one of its names appears as a whole word.
const limitBreachesIn = (entries: Entry[], text: string, roleId: string | undefined): string[] =>
  entries.flatMap(({ limit }) => {
    if (!limit) return []
    const written = namesOf(limit.name).find((n) =>
      new RegExp(`(?<![\\w])${escapeRegExp(n)}(?![\\w])`).test(text),
    )
    const satisfied =
      text.toLowerCase().includes(limit.claim_as.toLowerCase()) ||
      (roleId !== undefined && limit.roles.includes(roleId))
    return written && !satisfied
      ? [`"${written}" has a limit in profile/stack.yaml; write "${limit.claim_as}"`]
      : []
  })

// A pattern that does not compile is reported rather than skipped: a skipped pattern is a
// guard that is silently off, and the CV it was meant to stop would build without it.
const guardsOf = (list: StackFile['do_not_claim']) =>
  list.flatMap(({ item, patterns }) =>
    patterns.map((pattern) => {
      try {
        return { item, pattern, regex: new RegExp(pattern, 'i') }
      } catch (e) {
        // The engine's message opens with the pattern itself, which can hold ": ", so the known prefix is cut, not a split.
        const prefix = `Invalid regular expression: /${pattern}/i: `
        const message = e instanceof Error ? e.message : String(e)
        return {
          item,
          pattern,
          invalid: message.startsWith(prefix) ? message.slice(prefix.length) : message,
        }
      }
    }),
  )

const invalidPatterns = (guards: ReturnType<typeof guardsOf>): string[] =>
  guards.flatMap((g) =>
    'invalid' in g
      ? [`never-claim pattern "${g.pattern}" (${g.item}) is not a valid pattern: ${g.invalid}`]
      : [],
  )

const catchesIn = (guards: ReturnType<typeof guardsOf>, text: string): Catch[] =>
  guards.flatMap((g) =>
    'regex' in g && g.regex.test(text) ? [{ item: g.item, pattern: g.pattern }] : [],
  )

// What the Draft asks about a stack it has not yet written: the invalid patterns, and the
// text a valid one catches. It takes the list alone because the draft's values are not yet
// checked against the file's schema.
export const neverClaimsIn = (
  list: unknown,
): { invalid: string[]; catches: (text: string) => Catch[] } => {
  const parsed = StackFileSchema.shape.do_not_claim.safeParse(list)
  const guards = guardsOf(parsed.success ? parsed.data : [])
  return { invalid: invalidPatterns(guards), catches: (text) => catchesIn(guards, text) }
}

export const buildStack = (file: StackFile): Stack => {
  const entries = entriesOf(file)
  const guards = guardsOf(file.do_not_claim)
  return {
    sectionsOf: (item) =>
      SECTIONS.filter((s) =>
        entries.some((e) => e.section === s && e.tokens.includes(bareName(item))),
      ),
    claim: (item, roleId) => claimWith(entries, item, roleId),
    covers: (keyword) => entries.some((e) => looselyMatches(keyword, e.tokens)),
    breaches: (text) =>
      catchesIn(guards, text).map((c) => `do_not_claim "${c.item}" (/${c.pattern}/)`),
    limitBreaches: (text, roleId) => limitBreachesIn(entries, text, roleId),
    problems: (historyIds) => [
      ...entries.flatMap(({ limit }) =>
        (limit?.roles ?? [])
          .filter((role) => !historyIds.includes(role))
          .map(
            (role) =>
              `"${limit?.name}" limit names role "${role}", which is not in profile/history.yaml`,
          ),
      ),
      ...invalidPatterns(guards),
    ],
  }
}
