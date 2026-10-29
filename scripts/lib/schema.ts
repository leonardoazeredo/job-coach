// Shapes of the files the scripts read. The schemas are deliberately loose
// on content (any string is allowed) so that validate.ts, not the parser,
// reports what is wrong and where.
import { z } from 'zod'

const str = z.string()
const maybe = <T extends z.ZodType>(schema: T) => schema.nullish()
const strList = z.array(str).default([])

// The rules come from two files, so each has its own schema: config/rules.yaml holds the
// engine defaults and profile/search.yaml what is personal to the user. The merged
// shape that loadRules (lib/rules.ts) returns is `Rules`, below.
const engineFit = z.object({ statuses: z.array(str), untiered: z.array(str) })
const searchFit = z.object({ min_stack_overlap_pct: z.number() })
const engineDiscovery = z.object({ fresh_days: z.number().int() })
const searchDiscovery = z.object({
  search_titles: z.array(str),
  title_expansion: z.array(str),
  agentic_keywords: strList,
  search: z.object({
    city: str,
    country: str,
    regions: z.array(str),
    seniority: z.array(str),
    stack: z.array(str),
    employment: str,
    hybrid: z.boolean(),
  }),
})

export const EngineRulesSchema = z.object({
  fit: engineFit,
  staleness: z.object({
    applied_no_response_days: z.number().int(),
    post_interview_follow_up_business_days: z.number().int(),
    interview_prep_window_days: z.number().int(),
  }),
  statuses: z.array(str),
  status_reason_required: z.array(str),
  implies_applied: z.array(str),
  follow_up_statuses: z.array(str),
  board_groups: z.object({
    active: z.array(str),
    identified: z.array(str),
    waiting: z.array(str),
    closed: z.array(str),
  }),
  closed_recently_days: z.number().int(),
  events: z.array(str),
  discovery: engineDiscovery,
})
export type EngineRules = z.infer<typeof EngineRulesSchema>

export const SearchSchema = z.object({
  tiers: z.record(z.string(), z.object({ label: str, when: str, action: str })),
  fit: searchFit,
  discovery: searchDiscovery,
})
export type Search = z.infer<typeof SearchSchema>

const RulesSchema = z.object({
  ...EngineRulesSchema.shape,
  ...SearchSchema.shape,
  fit: engineFit.extend(searchFit.shape),
  discovery: engineDiscovery.extend(searchDiscovery.shape),
})
export type Rules = z.infer<typeof RulesSchema>
export type SearchPreferences = Rules['discovery']['search']

export const RecordSchema = z.looseObject({
  slug: str,
  company: str,
  job_title: maybe(str),
  status: str,
  status_reason: maybe(str),
  tier: maybe(z.number().int()),
  fit: z
    .object({
      verdict: maybe(str),
      reason: maybe(str),
      stack_overlap_pct: maybe(z.number()),
    })
    .default({}),
  dates: z
    .object({
      identified: maybe(str),
      applied: maybe(str),
      last_activity: maybe(str),
    })
    .default({}),
  next_action: z.object({ what: maybe(str), due: maybe(str) }).default({}),
  salary_range: maybe(str),
  core_stack_matches: strList,
  secondary_stack_matches: strList,
  tech_stack_gaps: strList,
  hook: z.object({ win_slugs: strList }).default({ win_slugs: [] }),
  campaign: maybe(str),
})
export type Record = z.infer<typeof RecordSchema>
