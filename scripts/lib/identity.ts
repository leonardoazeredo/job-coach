// The part of profile/identity.yaml the scripts read: the name that titles the PDF, the
// timezone and locale that make "today", and which competency pack the CV work uses.
import { z } from 'zod'

// What the engine ships, so an identity written before packs existed still loads.
export const DEFAULT_PACK = 'frontend'

export const IdentitySchema = z.object({
  name: z.string(),
  location: z.object({ timezone: z.string() }),
  locale: z.string().default('en-US'),
  // A file name under config/competencies/, so it may not carry a path.
  competency_pack: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and hyphens')
    .default(DEFAULT_PACK),
})
export type Identity = z.infer<typeof IdentitySchema>

// Upload forms and some filesystems refuse accents and punctuation, so the name is
// reduced to ASCII words before it titles a file.
const asciiWord = (word: string): string =>
  word
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
