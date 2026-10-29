// Renders a Board as the markdown pipeline-board shows the user.
import type { Board, BoardRow } from './board.ts'

const table = (header: string[], rows: string[][]): string => {
  if (rows.length === 0) return '_none_'
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

const days = (row: BoardRow): string => (row.days === undefined ? '' : String(row.days))

export const renderBoard = (board: Board): string => {
  const openCount = board.active.length + board.identified.length + board.waiting.length
  const parts: string[] = [
    `Pipeline as of ${board.today}: ${board.total} roles tracked (${openCount} open, ${board.stale.length} stale, ${board.closedTotal} closed)`,
    '',
    '## Interviews and conversations',
    table(
      ['Company', 'Role', 'Tier', 'Stage', 'Next action', 'Due'],
      board.active.map((r) => [r.company, r.title, r.tier, r.status, r.nextAction, r.due]),
    ),
    '',
    '## Identified, not yet applied',
    table(
      ['Company', 'Role', 'Tier', 'Next action', 'Due'],
      board.identified.map((r) => [r.company, r.title, r.tier, r.nextAction, r.due]),
    ),
    '',
    '## Waiting',
    table(
      ['Company', 'Role', 'Tier', 'Applied', 'Days'],
      board.waiting.map((r) => [r.company, r.title, r.tier, r.applied, days(r)]),
    ),
    '',
    '## Stale (no response past the limit)',
    table(
      ['Company', 'Role', 'Applied', 'Days'],
      board.stale.map((r) => [r.company, r.title, r.applied, days(r)]),
    ),
    '',
    `## Closed in the last ${board.closedRecentlyDays} days: ${board.closedRecently.length} (${board.closedTotal} closed in total)`,
  ]
  if (board.needsFixing.length > 0) {
    parts.push('', '## Needs fixing')
    for (const item of board.needsFixing) parts.push(`- ${item.slug}: ${item.reason}`)
  }
  parts.push('', '## Action items')
  const actions = [
    ...board.prepDue.map((r) => `- Prep due: ${r.company}, ${r.title} (${r.due})`),
    ...board.followUpDue.map((r) => `- Follow-up due: ${r.company}, ${r.title}`),
    ...(board.stale.length > 0
      ? [`- ${board.stale.length} stale roles to review with pipeline-update`]
      : []),
  ]
  parts.push(actions.length === 0 ? '- none' : actions.slice(0, 3).join('\n'))
  return `${parts.join('\n')}\n`
}
