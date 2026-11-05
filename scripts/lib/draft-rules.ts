// What a value must be, for the values a script or a named skill depends on. A value only the
// coach reads as text has no rule here: "10+" years or "2 to 3" office days are fair answers.
import { isLanguageTag, isTimezone } from './dates.ts'
import type { Rule } from './draft-fields.ts'

const isText = (v: unknown): v is string => typeof v === 'string'

export const TIMEZONE: Rule = {
  holds: (v) => isText(v) && isTimezone(v),
  needs: 'a real timezone name, such as Europe/Berlin',
}
export const LOCALE: Rule = {
  holds: (v) => isText(v) && isLanguageTag(v),
  needs: 'a language tag, such as en-GB',
}
export const CURRENCY: Rule = {
  holds: (v) => isText(v) && Intl.supportedValuesOf('currency').includes(v),
  needs: 'a currency code in capitals, such as EUR',
}
// Skills compare a role's pay against these, so text would quietly stop that working.
export const MONEY: Rule = {
  holds: (v) => typeof v === 'number' && Number.isFinite(v),
  needs: 'a number',
}
export const oneOf = (values: string[]): Rule => ({
  holds: (v) => isText(v) && values.includes(v),
  needs: `one of ${values.join(', ')}`,
})
// cv-build prints any type but "permanent" on the CV as a note beside the job, so a type has to
// be one fit to send to an employer.
export const EMPLOYMENT_TYPES = [
  'permanent',
  'contract',
  'fixed-term',
  'part-time',
  'freelance',
  'self-employed',
  'internship',
]
