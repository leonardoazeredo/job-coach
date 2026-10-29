// The record checker: every role folder against config/rules.yaml, profile/stack.yaml
// and profile/wins.yaml. Errors fail the check; warnings are listed only.

import { classifyDate, type DateKind, isDay } from './dates.ts'
import { newestEventDate, type PipelineEvent } from './events.ts'
import type { Problem } from './problem.ts'
import type { Profile } from './profile.ts'
import type { LoadedRole } from './role-folder.ts'
import type { Record } from './schema.ts'
import { type Sources, winRef } from './sources.ts'
import { APPLIED_EVENT, type StatusRules } from './status-rules.ts'

// sources is missing when the profile could not be read; the reference checks
// are then skipped and the profile problem is reported instead.
type ValidationContext = {
  sr: StatusRules
  sources: Sources | undefined
}

type Found = { errors: string[]; warnings: string[] }

// Month precision is honest when only the month is known, so it warns rather than fails.
const checkDate = (label: string, value: string, out: Found, allowed: DateKind[]): void => {
  const kind = classifyDate(value)
  if (kind === 'month') out.warnings.push(`${label} "${value}" is month precision`)
  else if (kind !== 'day' && !allowed.includes(kind))
    out.errors.push(`${label} "${value}" is not YYYY-MM-DD`)
}

const checkStatus = (record: Record, sr: StatusRules): string[] => {
  const problems: string[] = []
  if (!sr.isStatus(record.status)) {
    problems.push(`status "${record.status}" is not in rules.yaml statuses`)
  }
  if (sr.needsReason(record.status) && !record.status_reason) {
    problems.push(`status "${record.status}" needs a status_reason`)
  }
  const { verdict } = record.fit
  if (verdict != null && !sr.isFitVerdict(verdict)) {
    problems.push(`fit.verdict "${verdict}" is not in rules.yaml fit.statuses`)
  }
  if (!sr.mayCarryTier(verdict) && record.tier != null) {
    problems.push(`tier must be null when fit.verdict is "${verdict}"`)
  }
  if (record.tier != null && !sr.isTier(record.tier)) {
    problems.push(`tier ${record.tier} is not defined in rules.yaml tiers`)
  }
  return problems
}

const checkDates = (record: Record, sr: StatusRules): Found => {
  const out: Found = { errors: [], warnings: [] }
  for (const [name, value] of Object.entries(record.dates)) {
    if (value != null) checkDate(`dates.${name}`, value, out, ['not specified'])
  }
  const { due } = record.next_action
  if (due != null && !isDay(due)) out.errors.push(`next_action.due "${due}" is not YYYY-MM-DD`)
  if (sr.impliesApplied(record.status) && !isDay(record.dates.applied)) {
    out.errors.push(`status "${record.status}" needs dates.applied`)
  }
  return out
}

const checkEvents = (record: Record, events: PipelineEvent[], sr: StatusRules): Found => {
  const out: Found = { errors: [], warnings: [] }
  const newest = newestEventDate(events)
  if (newest && record.dates.last_activity !== newest) {
    out.errors.push(
      `dates.last_activity "${record.dates.last_activity}" differs from the newest event (${newest})`,
    )
  }
  if (isDay(record.dates.applied) && !events.some((e) => e.event === APPLIED_EVENT)) {
    out.errors.push(`dates.applied is set but events.md has no "${APPLIED_EVENT}" row`)
  }
  for (const e of events) {
    if (!sr.isEvent(e.event))
      out.errors.push(`events.md line ${e.line}: event "${e.event}" is not in rules.yaml events`)
    checkDate(`events.md line ${e.line}: date`, e.date, out, [])
  }
  return out
}

const checkReferences = (record: Record, ctx: ValidationContext): Found => {
  const { sources } = ctx
  if (!sources) return { errors: [], warnings: [] }
  const { stack } = sources
  const errors: string[] = []
  for (const item of record.core_stack_matches) {
    if (!stack.sectionsOf(item).includes('core'))
      errors.push(`core_stack_matches "${item}" is not in stack.yaml core`)
  }
  for (const item of record.secondary_stack_matches) {
    if (!stack.sectionsOf(item).includes('secondary')) {
      errors.push(`secondary_stack_matches "${item}" is not in stack.yaml secondary`)
    }
  }
  // The hook is pitched outward, so it may name only wins a CV could cite.
  for (const slug of record.hook.win_slugs) {
    const cited = sources.cite(winRef(slug))
    if (!cited.ok) errors.push(`hook.win_slugs: ${cited.reason}`)
  }
  // A gap the stack lists is usually a misfiled match, but "study only" can honestly be a gap.
  const warnings = record.tech_stack_gaps.flatMap((item) => {
    const sections = stack.sectionsOf(item)
    return sections.length > 0
      ? [`tech_stack_gaps "${item}" is in stack.yaml ${sections.join(', ')}`]
      : []
  })
  return { errors, warnings }
}

const checkRole = (role: LoadedRole, ctx: ValidationContext): Problem[] => {
  const problems = [...role.problems]
  if (role.record === undefined) return problems
  const add = (level: Problem['level'], messages: string[]) => {
    for (const message of messages) problems.push({ slug: role.slug, level, message })
  }
  const { record } = role
  const { sr } = ctx
  add('error', checkStatus(record, sr))
  for (const found of [
    checkDates(record, sr),
    checkEvents(record, role.events, sr),
    checkReferences(record, ctx),
  ]) {
    add('error', found.errors)
    add('warning', found.warnings)
  }
  return problems
}

export const checkRecords = (
  sr: StatusRules,
  profile: Profile | undefined,
  roles: LoadedRole[],
): Problem[] => {
  const ctx = { sr, sources: profile?.sources }
  return roles.flatMap((role) => checkRole(role, ctx))
}
