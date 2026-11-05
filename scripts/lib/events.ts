// Parses pipeline/<slug>/events.md: a markdown table, one row per event,
// newest at the bottom. Rows that do not parse are reported, never skipped.
import { isDay } from './dates.ts'

export type PipelineEvent = {
  date: string
  time: string
  event: string
  detail: string
  source: string
  line: number
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

const isSeparator = (cells: string[]): boolean => cells.every((c) => /^:?-+:?$/.test(c))

export const parseEvents = (
  markdown: string,
): { events: PipelineEvent[]; eventErrors: string[] } => {
  const events: PipelineEvent[] = []
  const eventErrors: string[] = []
  let headerSeen = false
  markdown.split('\n').forEach((raw, index) => {
    if (!raw.trim().startsWith('|')) return
    const cells = splitRow(raw)
    // The table's first row is its header whatever it says: waiting for a
    // "Date" header would read a renamed column as an empty, error-free file.
    if (!headerSeen) {
      headerSeen = true
      if (cells[0]?.toLowerCase() !== 'date') {
        eventErrors.push(
          `events.md line ${index + 1}: the first column must be Date, found "${cells[0] ?? ''}"`,
        )
      }
      return
    }
    if (isSeparator(cells)) return
    if (cells.length !== 5) {
      eventErrors.push(`events.md line ${index + 1}: expected 5 columns, found ${cells.length}`)
      return
    }
    const [date = '', time = '', event = '', detail = '', source = ''] = cells
    events.push({ date, time, event, detail, source, line: index + 1 })
  })
  return { events, eventErrors }
}

export const newestEventDate = (events: PipelineEvent[]): string | undefined => {
  const dates = events.map((e) => e.date).filter(isDay)
  return dates.length === 0 ? undefined : dates.reduce((a, b) => (a > b ? a : b))
}
