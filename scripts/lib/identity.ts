// The part of profile/identity.yaml the scripts read: the name that titles the PDF, the
// timezone and locale that make "today", and which competency pack the CV work uses.
import { z } from 'zod'

// Only so the record check can load an identity written before packs existed. The CV
// commands refuse such an identity instead (see packRefusal in workspace.ts), because a
// pack the user never chose would decide what their CV is matched against.
export const LEGACY_PACK = 'frontend'

export const IdentitySchema = z.object({
  name: z.string(),
  location: z.object({ timezone: z.string() }),
  locale: z.string().default('en-US'),
  // A file name under config/competencies/, so it may not carry a path. Optional so that
  // "names no pack" stays distinguishable from "chose frontend".
  competency_pack: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and hyphens')
    .optional(),
})
export type Identity = z.infer<typeof IdentitySchema>

// Upload forms and some filesystems refuse accents and punctuation, so the name is
// reduced to ASCII words before it titles a file. Normalisation cannot split these letters
// into a base and an accent, so they are spelled out first or they would just vanish.
const TRANSLITERATIONS: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Ø: 'O',
  ø: 'o',
  Æ: 'AE',
  æ: 'ae',
  Œ: 'OE',
  œ: 'oe',
  ß: 'ss',
  Đ: 'D',
  đ: 'd',
  Ð: 'D',
  ð: 'd',
  Þ: 'TH',
  þ: 'th',
  ı: 'i',
}

const asciiWord = (word: string): string =>
  word
    .replace(/[ŁłØøÆæŒœßĐđÐðÞþı]/g, (letter) => TRANSLITERATIONS[letter] ?? '')
    .normalize('NFD')
    .replace(/[^A-Za-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')

// "<First>-<Last>-CV.pdf": the first and last words of the name, so middle names and
// particles stay out of the file name. A one-word name gives "<First>-CV.pdf", and a name
// with no ASCII letters gives "CV.pdf".
export const pdfFileName = (name: string): string => {
  const words = name.split(/\s+/).map(asciiWord).filter(Boolean)
  const [first] = words
  const last = words.length > 1 ? words.at(-1) : undefined
  return [first, last, 'CV.pdf'].filter(Boolean).join('-')
}
