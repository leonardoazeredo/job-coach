// Date values as the data files write them. Record and event dates are classified
// the same way here, rather than by patterns in each caller; each caller decides
// which kinds it accepts.
import { NOT_SPECIFIED } from './not-specified.ts'

export type DateKind = 'day' | 'month' | 'not specified' | 'empty' | 'invalid'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/

export const classifyDate = (value: string | null | undefined): DateKind => {
  if (value == null) return 'empty'
  if (ISO_DATE.test(value)) return 'day'
  if (ISO_MONTH.test(value)) return 'month'
  if (value === NOT_SPECIFIED) return 'not specified'
  return 'invalid'
}

export const isDay = (value: string | null | undefined): value is string =>
  classifyDate(value) === 'day'

const MS_PER_DAY = 86_400_000

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY)

export const businessDaysBetween = (from: string, to: string): number => {
  let count = 0
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  while (cursor.getTime() < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) count += 1
  }
  return count
}

// The calendar day at `now` in an IANA timezone. The UTC day is already tomorrow in the
// evening west of Greenwich, and still yesterday just after midnight east of it, which
// would shift every date rule by a day. The locale comes from identity.yaml; Latin digits
// and the Gregorian calendar are forced so any locale still yields an ISO date. Throws a
// RangeError for a name that is not a timezone or a locale that is not a language tag.
export const todayIn = (timeZone: string, now = new Date(), locale = 'en-US'): string => {
  const parts = new Intl.DateTimeFormat(
    new Intl.Locale(locale, { numberingSystem: 'latn', calendar: 'gregory' }),
    {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
