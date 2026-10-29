import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeBoard } from '../lib/board.ts'
import { renderBoard } from '../lib/render.ts'
import { listSlugs, readRole } from '../lib/role-folder.ts'
import { statusRules } from '../lib/status-rules.ts'
import { personaRules, type TempRepo, tempRepo } from './temp-repo.ts'

const today = '2026-10-22'

let repo: TempRepo
beforeEach(() => {
  repo = tempRepo()
})
afterEach(() => repo.dispose())

const boardOn = (day: string) => {
  const { board, problems } = repo.workspace().board(day)
  expect(problems).toEqual([])
  if (!board) throw new Error('no board')
  return board
}

describe('board', () => {
  it('computes the board for a given day', () => {
    repo.addRole('acme-engineer')
    repo.addRole('acme-design', {
      status: 'Identified',
      dates: { identified: '2026-10-05', applied: null, last_activity: '2026-10-05' },
    })
    expect(boardOn('2026-10-10').waiting.map((r) => r.slug)).toEqual(['acme-engineer'])
    const board = boardOn(today)
    expect(board.identified.map((r) => r.slug)).toEqual(['acme-design'])
    expect(board.stale.map((r) => r.slug)).toEqual(['acme-engineer'])
  })

  it('splits Applied roles into waiting and stale by the staleness limit', () => {
    repo.addRole('fresh', {
      dates: { identified: '2026-10-20', applied: '2026-10-20', last_activity: '2026-10-20' },
    })
    repo.addRole('old', {
      dates: { identified: '2026-09-16', applied: '2026-09-16', last_activity: '2026-09-16' },
    })
    const board = boardOn(today)
    expect(board.waiting.map((r) => r.slug)).toEqual(['fresh'])
    expect(board.stale.map((r) => [r.slug, r.days])).toEqual([['old', 36]])
  })

  it('turns a waiting role stale one day past the limit, with the days that were judged', () => {
    // The dates sit on, and one day past, applied_no_response_days in config/rules.yaml.
    repo.addRole('on-limit', { dates: { applied: '2026-10-12', last_activity: '2026-10-12' } })
    repo.addRole('past-limit', { dates: { applied: '2026-10-11', last_activity: '2026-10-11' } })
    const board = boardOn('2026-10-26')
    expect(board.waiting.map((r) => [r.slug, r.days])).toEqual([['on-limit', 14]])
    expect(board.stale.map((r) => [r.slug, r.days])).toEqual([['past-limit', 15]])
  })

  it('gives every status a group, so nothing is dropped silently', () => {
    const { statuses } = personaRules()
    for (const [i, status] of statuses.entries()) {
      repo.addRole(`r${i}`, {
        status,
        status_reason: 'reason',
        dates: { identified: '2026-10-01', applied: '2026-10-03', last_activity: '2026-10-03' },
      })
    }
    const board = boardOn(today)
    const placed =
      board.active.length +
      board.identified.length +
      board.waiting.length +
      board.stale.length +
      board.closedTotal
    expect(placed).toBe(statuses.length)
    expect(board.needsFixing).toEqual([])
  })

  it('lists an unreadable record under needs fixing and an unknown status too', () => {
    repo.addRole('broken').write('record.yaml', 'status: [unclosed\n')
    repo.addRole('odd', { status: 'Paused' })
    expect(boardOn(today).needsFixing).toEqual([
      { slug: 'broken', reason: expect.stringMatching(/^record\.yaml could not be read: /) },
      { slug: 'odd', reason: 'status "Paused" is in no board group' },
    ])
  })

  it('raises follow-up and prep actions from dates', () => {
    repo.addRole('quiet', {
      status: 'Interviewing',
      dates: { identified: '2026-09-01', applied: '2026-09-02', last_activity: '2026-10-09' },
    })
    repo.addRole('soon', {
      status: 'Interviewing',
      dates: { identified: '2026-09-01', applied: '2026-09-02', last_activity: '2026-10-21' },
      next_action: { what: 'Technical round', due: '2026-10-23' },
    })
    const board = boardOn(today)
    expect(board.followUpDue.map((r) => r.slug)).toEqual(['quiet'])
    expect(board.prepDue.map((r) => r.slug)).toEqual(['soon'])
    const text = renderBoard(board)
    expect(text).toContain('Pipeline as of 2026-10-22: 2 roles tracked (2 open, 0 stale, 0 closed)')
    expect(text).toContain('- Prep due: Acme, Engineer (2026-10-23)')
    expect(text).toContain('- Follow-up due: Acme, Engineer')
  })

  it('computes a board from status rules built once by the caller', () => {
    repo.addRole('acme-engineer')
    const root = repo.path('')
    const roles = listSlugs(root).map((slug) => readRole(root, slug))
    const board = computeBoard(roles, statusRules(personaRules()), '2026-10-10')
    expect(board.waiting.map((r) => r.slug)).toEqual(['acme-engineer'])
  })

  it('refuses to compute a board when a status sits in no board group', () => {
    repo.editRules((r) => {
      r.board_groups.waiting = []
    })
    expect(repo.workspace().board(today)).toEqual({
      board: undefined,
      problems: [
        {
          slug: 'config/rules.yaml',
          level: 'error',
          message: 'status "Applied" appears in 0 board groups, expected 1',
        },
      ],
    })
  })
})
