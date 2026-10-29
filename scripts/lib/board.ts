// Computes the pipeline board from the loaded roles. Pure: dates come in as
// ISO strings and "today" is a parameter, so the output is reproducible.
import type { LoadedRole } from './role-folder.ts'
import type { Record } from './schema.ts'
import type { BoardGroup, StatusRules } from './status-rules.ts'

export type BoardRow = {
  slug: string
  company: string
  title: string
  tier: string
  status: string
  applied: string
  days: number | undefined
  nextAction: string
  due: string
}

export type Board = {
  today: string
  total: number
  active: BoardRow[]
  identified: BoardRow[]
  waiting: BoardRow[]
  stale: BoardRow[]
  closedRecently: BoardRow[]
  closedRecentlyDays: number
  closedTotal: number
  needsFixing: { slug: string; reason: string }[]
  followUpDue: BoardRow[]
  prepDue: BoardRow[]
}

const toRow = (slug: string, record: Record, days: number | undefined): BoardRow => ({
  slug,
  company: record.company,
  title: record.job_title ?? '',
  tier: record.tier == null ? '' : String(record.tier),
  status: record.status,
  applied: record.dates.applied ?? '',
  days,
  nextAction: record.next_action.what ?? '',
  due: record.next_action.due ?? '',
})

const byDueThenCompany = (a: BoardRow, b: BoardRow): number =>
  (a.due || '9999').localeCompare(b.due || '9999') || a.company.localeCompare(b.company)

export const computeBoard = (roles: LoadedRole[], sr: StatusRules, today: string): Board => {
  const board: Board = {
    today,
    total: roles.length,
    active: [],
    identified: [],
    waiting: [],
    stale: [],
    closedRecently: [],
    closedRecentlyDays: sr.closedRecentlyDays,
    closedTotal: 0,
    needsFixing: [],
    followUpDue: [],
    prepDue: [],
  }
  for (const role of roles) {
    if (role.record === undefined) {
      for (const p of role.problems) board.needsFixing.push({ slug: role.slug, reason: p.message })
      continue
    }
    const group = sr.groupOf(role.record.status)
    if (group === undefined) {
      board.needsFixing.push({
        slug: role.slug,
        reason: `status "${role.record.status}" is in no board group`,
      })
      continue
    }
    const { record } = role
    const { days, stale } = sr.sinceApplied(record, today)
    placeRow({ board, sr, row: toRow(role.slug, record, days), record, stale }, group)
  }
  board.active.sort(byDueThenCompany)
  board.identified.sort(byDueThenCompany)
  board.waiting.sort((a, b) => b.applied.localeCompare(a.applied))
  board.stale.sort((a, b) => a.applied.localeCompare(b.applied))
  return board
}

type Placement = { board: Board; sr: StatusRules; row: BoardRow; record: Record; stale: boolean }

const placeActive = ({ board, sr, row, record }: Placement): void => {
  board.active.push(row)
  if (sr.followUpDue(record, board.today)) board.followUpDue.push(row)
  if (row.due && sr.prepDue(row.due, board.today)) board.prepDue.push(row)
}

const placeClosed = ({ board, sr, row, record }: Placement): void => {
  board.closedTotal += 1
  if (sr.closedRecently(record.dates.last_activity ?? '', board.today))
    board.closedRecently.push(row)
}

const placeRow = (placement: Placement, group: BoardGroup): void => {
  const { board, row, stale } = placement
  switch (group) {
    case 'active':
      placeActive(placement)
      return
    case 'identified':
      board.identified.push(row)
      return
    case 'waiting':
      if (stale) board.stale.push(row)
      else board.waiting.push(row)
      return
    case 'closed':
      placeClosed(placement)
      return
    default:
      return
  }
}
