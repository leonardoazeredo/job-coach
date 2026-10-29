import { describe, expect, it } from 'vitest'
import { businessDaysBetween, daysBetween } from '../lib/dates.ts'
import { statusRules } from '../lib/status-rules.ts'
import { record } from './fixtures.ts'
import { personaRules } from './temp-repo.ts'

const today = '2026-10-22'
const rules = personaRules()
const sr = statusRules(rules)

describe('date arithmetic', () => {
  it('counts calendar and business days', () => {
    expect(daysBetween('2026-10-01', today)).toBe(21)
    expect(businessDaysBetween('2026-10-16', today)).toBe(4) // Fri 16 to Thu 22: Mon to Thu
  })
})

describe('statusRules', () => {
  it('knows which statuses imply an application', () => {
    expect(sr.impliesApplied('Likely rejected')).toBe(true)
    expect(sr.impliesApplied('Interviewing')).toBe(true)
    expect(sr.impliesApplied('Rejected')).toBe(false)
    expect(sr.impliesApplied('Withdrawn')).toBe(false)
    expect(sr.impliesApplied('Identified')).toBe(false)
  })

  it('knows which statuses need a reason and which group each sits in', () => {
    expect(sr.needsReason('Skipped')).toBe(true)
    expect(sr.needsReason('Applied')).toBe(false)
    expect(sr.groupOf('Applied')).toBe('waiting')
    expect(sr.groupOf('Ended')).toBe('closed')
    expect(sr.groupOf('Paused')).toBeUndefined()
  })

  it('knows the event vocabulary', () => {
    expect(sr.isEvent('Identified')).toBe(true)
    expect(sr.isEvent('Ghosted (no-show)')).toBe(true)
    expect(sr.isEvent('Phoned')).toBe(false)
  })

  it('answers staleness, follow-up, prep and closed-recently on a given day', () => {
    const applied = (date: string | null, status = 'Applied') =>
      sr.sinceApplied(record({ status, dates: { applied: date } }), today)
    expect(applied('2026-10-08')).toEqual({ days: 14, stale: false })
    expect(applied('2026-10-07')).toEqual({ days: 15, stale: true })
    expect(applied('2026-10-07', 'Interviewing')).toEqual({ days: 15, stale: false })
    expect(applied(null)).toEqual({ days: undefined, stale: false })
    const quiet = record({
      status: 'Interviewing',
      dates: { identified: '2026-09-01', applied: '2026-09-02', last_activity: '2026-10-09' },
    })
    expect(sr.followUpDue(quiet, today)).toBe(true)
    expect(sr.followUpDue({ ...quiet, status: 'Offer' }, today)).toBe(false)
    expect(sr.prepDue('2026-10-25', today)).toBe(true)
    expect(sr.prepDue('2026-10-26', today)).toBe(false)
    expect(sr.prepDue('2026-10-21', today)).toBe(false)
    expect(sr.closedRecently('2026-09-22', today)).toBe(true)
    expect(sr.closedRecently('2026-09-21', today)).toBe(false)
  })

  it('finds the real config consistent', () => {
    expect(sr.problems()).toEqual([])
  })

  const rulesError = (message: string) => ({ slug: 'config/rules.yaml', level: 'error', message })

  it('reports a status in zero or two board groups', () => {
    const broken = statusRules({
      ...rules,
      board_groups: {
        ...rules.board_groups,
        waiting: [],
        closed: [...rules.board_groups.closed, 'Offer'],
      },
    })
    expect(broken.problems()).toEqual([
      rulesError('status "Applied" appears in 0 board groups, expected 1'),
      rulesError('status "Offer" appears in 2 board groups, expected 1'),
    ])
  })

  it('reports status lists that name unknown statuses, and a missing Applied event', () => {
    const broken = statusRules({
      ...rules,
      implies_applied: [...rules.implies_applied, 'Hired'],
      follow_up_statuses: ['Chasing'],
      board_groups: {
        ...rules.board_groups,
        active: [...rules.board_groups.active, 'Interviewng'],
      },
      events: rules.events.filter((e) => e !== 'Applied'),
    })
    expect(broken.problems()).toEqual([
      rulesError('implies_applied "Hired" is not in statuses'),
      rulesError('follow_up_statuses "Chasing" is not in statuses'),
      rulesError('board_groups "Interviewng" is not in statuses'),
      rulesError('events must include "Applied"'),
    ])
  })
})
