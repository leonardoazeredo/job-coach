// What config/rules.yaml says about a role's lifecycle: which statuses imply an
// application or need a reason, which board group each status belongs to, which
// event names and fit verdicts are allowed, and what is stale or due on a given day.
// validate.ts and board.ts ask here instead of naming statuses or verdicts themselves.
import { businessDaysBetween, daysBetween, isDay } from './dates.ts'
import { error, type Problem } from './problem.ts'
import type { Record, Rules } from './schema.ts'

export type BoardGroup = keyof Rules['board_groups']

// dates.applied must be backed by an events.md row with this name, so rules.yaml
// events must list it.
export const APPLIED_EVENT = 'Applied'

const RULES_SLUG = 'config/rules.yaml'

export type StatusRules = {
  isStatus: (status: string) => boolean
  impliesApplied: (status: string) => boolean
  needsReason: (status: string) => boolean
  groupOf: (status: string) => BoardGroup | undefined
  isEvent: (name: string) => boolean
  isFitVerdict: (verdict: string) => boolean
  mayCarryTier: (verdict: string | null | undefined) => boolean
  isTier: (tier: number) => boolean
  sinceApplied: (record: Record, today: string) => { days: number | undefined; stale: boolean }
  followUpDue: (record: Record, today: string) => boolean
  prepDue: (due: string, today: string) => boolean
  closedRecently: (lastActivity: string, today: string) => boolean
  closedRecentlyDays: number
  problems: () => Problem[]
}

const groupCoverage = (rules: Rules): string[] => {
  const seen = new Map<string, number>()
  for (const list of Object.values(rules.board_groups)) {
    for (const status of list) seen.set(status, (seen.get(status) ?? 0) + 1)
  }
  return rules.statuses.flatMap((status) => {
    const n = seen.get(status) ?? 0
    return n === 1 ? [] : [`status "${status}" appears in ${n} board groups, expected 1`]
  })
}

const unknownVerdicts = (rules: Rules): string[] =>
  rules.fit.untiered
    .filter((v) => !rules.fit.statuses.includes(v))
    .map((v) => `fit.untiered "${v}" is not in fit.statuses`)

const unknownStatuses = (rules: Rules): string[] => {
  const lists = {
    status_reason_required: rules.status_reason_required,
    implies_applied: rules.implies_applied,
    follow_up_statuses: rules.follow_up_statuses,
    board_groups: Object.values(rules.board_groups).flat(),
  }
  return Object.entries(lists).flatMap(([key, list]) =>
    list.filter((s) => !rules.statuses.includes(s)).map((s) => `${key} "${s}" is not in statuses`),
  )
}

export const statusRules = (rules: Rules): StatusRules => {
  const groups = Object.entries(rules.board_groups) as [BoardGroup, string[]][]
  const { staleness } = rules
  return {
    isStatus: (status) => rules.statuses.includes(status),
    impliesApplied: (status) => rules.implies_applied.includes(status),
    needsReason: (status) => rules.status_reason_required.includes(status),
    groupOf: (status) => groups.find(([, list]) => list.includes(status))?.[0],
    isEvent: (name) => rules.events.includes(name),
    isFitVerdict: (verdict) => rules.fit.statuses.includes(verdict),
    mayCarryTier: (verdict) => verdict == null || !rules.fit.untiered.includes(verdict),
    isTier: (tier) => Object.keys(rules.tiers).includes(String(tier)),
    // Only a role still waiting on a reply can go stale; later statuses have their own follow-ups.
    sinceApplied: (record, today) => {
      const applied = record.dates.applied
      const days = isDay(applied) ? daysBetween(applied, today) : undefined
      const waiting = rules.board_groups.waiting.includes(record.status)
      return {
        days,
        stale: waiting && days !== undefined && days > staleness.applied_no_response_days,
      }
    },
    followUpDue: (record, today) => {
      const last = record.dates.last_activity
      return (
        rules.follow_up_statuses.includes(record.status) &&
        isDay(last) &&
        businessDaysBetween(last, today) > staleness.post_interview_follow_up_business_days
      )
    },
    prepDue: (due, today) => {
      const until = daysBetween(today, due)
      return until >= 0 && until <= staleness.interview_prep_window_days
    },
    closedRecently: (lastActivity, today) =>
      isDay(lastActivity) && daysBetween(lastActivity, today) <= rules.closed_recently_days,
    closedRecentlyDays: rules.closed_recently_days,
    problems: () =>
      [
        ...groupCoverage(rules),
        ...unknownStatuses(rules),
        ...unknownVerdicts(rules),
        ...(rules.events.includes(APPLIED_EVENT) ? [] : [`events must include "${APPLIED_EVENT}"`]),
      ].map((message) => error(RULES_SLUG, message)),
  }
}
