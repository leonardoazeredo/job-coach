import { describe, expect, it } from 'vitest'
import { newestEventDate, parseEvents } from '../lib/events.ts'

const sample = `# Events: Acme, Engineer

Append-only. Newest at the bottom.

| Date | Time (tz) | Event | Detail | Source |
| --- | --- | --- | --- | --- |
| 2026-10-01 |  | Identified | Pasted by Dana | chat |
| 2026-10-03 | 14:00 (America/Chicago) | Applied | Via site | Dana |
`

describe('parseEvents', () => {
  it('reads one event per table row and skips the header', () => {
    const { events, eventErrors } = parseEvents(sample)
    expect(eventErrors).toEqual([])
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ date: '2026-10-03', event: 'Applied', source: 'Dana' })
  })

  it('reports rows with the wrong number of columns instead of dropping them', () => {
    const { events, eventErrors } = parseEvents(`${sample}| 2026-10-04 | Rejected |\n`)
    expect(events).toHaveLength(2)
    expect(eventErrors).toEqual(['events.md line 9: expected 5 columns, found 2'])
  })

  it('finds the newest full date and ignores month-only dates', () => {
    const { events } = parseEvents(`${sample}| 2026-11 |  | Other |  | chat |\n`)
    expect(newestEventDate(events)).toBe('2026-10-03')
    expect(newestEventDate([])).toBeUndefined()
  })
})
