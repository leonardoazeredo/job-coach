import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { record } from './fixtures.ts'
import { type Row, type TempRepo, tempRepo } from './temp-repo.ts'

const ACME = 'acme-engineer'
// Rows start on line 7 of pipeline/_templates/events.md, so a third row sits on line 9.
const APPLIED_ROWS: Row[] = [
  ['2026-10-01', 'Identified'],
  ['2026-10-03', 'Applied'],
]

let repo: TempRepo
beforeEach(() => {
  repo = tempRepo()
})
afterEach(() => repo.dispose())

const problems = () => repo.workspace().check().problems
const messagesFor = (slug: string) =>
  problems()
    .filter((p) => p.slug === slug)
    .map((p) => `${p.level}: ${p.message}`)
const errors = () =>
  problems()
    .filter((p) => p.level === 'error')
    .map((p) => `${p.slug}: ${p.message}`)

describe('record checker', () => {
  it('accepts a consistent applied record', () => {
    repo.addRole(ACME)
    expect(messagesFor(ACME)).toEqual([])
  })

  it('rejects a status outside rules.yaml and a missing reason', () => {
    repo.addRole(ACME, { status: 'Ghosted' })
    expect(messagesFor(ACME)).toContain('error: status "Ghosted" is not in rules.yaml statuses')
    repo.addRole(ACME, { status: 'Rejected' })
    expect(messagesFor(ACME)).toContain('error: status "Rejected" needs a status_reason')
  })

  it('requires an Applied event behind dates.applied and keeps last_activity on the newest event', () => {
    repo.addRole(ACME, {}, [['2026-10-01', 'Identified']])
    expect(messagesFor(ACME)).toContain(
      'error: dates.applied is set but events.md has no "Applied" row',
    )
    repo.addRole(ACME, {
      dates: { identified: '2026-10-01', applied: '2026-10-03', last_activity: '2026-10-01' },
    })
    expect(messagesFor(ACME)).toContain(
      'error: dates.last_activity "2026-10-01" differs from the newest event (2026-10-03)',
    )
  })

  it('requires dates.applied for every status that implies applying, Likely rejected included', () => {
    const unapplied = { identified: '2026-10-01', applied: null, last_activity: '2026-10-03' }
    repo.addRole(ACME, { status: 'Likely rejected', status_reason: 'No reply', dates: unapplied })
    expect(messagesFor(ACME)).toContain('error: status "Likely rejected" needs dates.applied')
    repo.addRole(ACME, { status: 'Rejected', status_reason: 'Email', dates: unapplied }, [
      ['2026-10-01', 'Identified'],
      ['2026-10-03', 'Rejected'],
    ])
    expect(messagesFor(ACME)).toEqual([])
  })

  it('rejects an event name outside rules.yaml events', () => {
    repo.addRole(ACME, {}, [...APPLIED_ROWS, ['2026-10-03', 'Phoned']])
    expect(messagesFor(ACME)).toEqual([
      'error: events.md line 9: event "Phoned" is not in rules.yaml events',
    ])
  })

  it('flags stack matches that are not in the profile stack', () => {
    repo.addRole(ACME, { core_stack_matches: ['Angular'], secondary_stack_matches: ['gRPC'] })
    expect(messagesFor(ACME)).toEqual([
      'error: core_stack_matches "Angular" is not in stack.yaml core',
    ])
  })

  it('warns about a gap that the stack lists', () => {
    repo.addRole(ACME, { tech_stack_gaps: ['Git', 'Vue'] })
    expect(messagesFor(ACME)).toEqual(['warning: tech_stack_gaps "Git" is in stack.yaml tools'])
  })

  it('reports an unreadable record instead of skipping the folder', () => {
    repo.addRole(ACME).writeYaml('record.yaml', { ...record({ slug: ACME }), status: 3 })
    expect(messagesFor(ACME)).toEqual([
      expect.stringMatching(/^error: record\.yaml could not be read: status: /),
    ])
  })

  it('reports a missing record as a problem of the folder', () => {
    repo.addRole(ACME).remove('record.yaml')
    expect(messagesFor(ACME)).toEqual(['error: record.yaml is missing'])
  })

  it('rejects a record whose slug is not the folder name', () => {
    repo.addRole(ACME, { slug: 'other' })
    expect(messagesFor(ACME)).toEqual(['error: record.yaml slug "other" differs from the folder'])
  })

  it('reports a missing events.md', () => {
    const unapplied = { identified: '2026-10-01', applied: null, last_activity: '2026-10-01' }
    repo.addRole(ACME, { status: 'Identified', dates: unapplied }).remove('events.md')
    expect(messagesFor(ACME)).toEqual(['error: events.md is missing'])
  })

  it('reports an unreadable events.md row by line', () => {
    const acme = repo.addRole(ACME)
    acme.write('events.md', `${acme.read('events.md')}| 2026-10-04 | Rejected |\n`)
    expect(messagesFor(ACME)).toEqual(['error: events.md line 9: expected 5 columns, found 2'])
  })
})

describe('dates', () => {
  it('words month-precision dates the same in records and in events, and accepts Not specified', () => {
    const dates = { identified: 'Not specified', applied: null, last_activity: '2026-02' }
    repo.addRole(ACME, { status: 'Rejected', status_reason: 'Email', dates }, [
      ['2026-02', 'Rejected'],
    ])
    expect(messagesFor(ACME)).toEqual([
      'warning: dates.last_activity "2026-02" is month precision',
      'warning: events.md line 7: date "2026-02" is month precision',
    ])
  })

  it('words malformed dates the same in records and in events', () => {
    const dates = { identified: 'yesterday', applied: '2026-10-03', last_activity: '2026-10-03' }
    repo.addRole(ACME, { dates }, [...APPLIED_ROWS, ['last week', 'Other']])
    expect(messagesFor(ACME)).toEqual([
      'error: dates.identified "yesterday" is not YYYY-MM-DD',
      'error: events.md line 9: date "last week" is not YYYY-MM-DD',
    ])
  })
})

describe('fit verdicts', () => {
  it('fails a tier on a verdict that rules.yaml marks untiered', () => {
    repo.addRole(ACME, { fit: { verdict: 'Not a fit', reason: 'Java backend' } })
    expect(messagesFor(ACME)).toEqual(['error: tier must be null when fit.verdict is "Not a fit"'])
    repo.addRole(ACME, { fit: { verdict: 'Not a fit', reason: 'Java backend' }, tier: null })
    expect(messagesFor(ACME)).toEqual([])
  })

  it('keeps the tier rule when the verdict is renamed in rules.yaml', () => {
    repo.editRules((r) => {
      const rename = (s: string) => (s === 'Not a fit' ? 'No fit' : s)
      r.fit.statuses = r.fit.statuses.map(rename)
      r.fit.untiered = r.fit.untiered.map(rename)
    })
    repo.addRole(ACME, { fit: { verdict: 'No fit', reason: 'Java backend' } })
    expect(errors()).toEqual([`${ACME}: tier must be null when fit.verdict is "No fit"`])
  })

  it('reports an untiered verdict missing from fit.statuses once, however many roles there are', () => {
    repo.editRules((r) => {
      r.fit.untiered.push('Unfit')
    })
    repo.addRole(ACME)
    repo.addRole('acme-other')
    repo.addRole('acme-third')
    expect(errors()).toEqual(['config/rules.yaml: fit.untiered "Unfit" is not in fit.statuses'])
  })
})
