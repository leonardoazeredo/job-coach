import type { CvData } from '../types.ts'
import type { Expectations } from './types.ts'

// `adKeywords` are the role ad's words that the CV claims; losing one in extraction is
// what an ATS keyword match would miss, so they are checked like skills.
export function expectations(data: Partial<CvData>, adKeywords: string[] = []): Expectations {
  const keywords = (data.skills ?? []).filter((s) => s.length > 2)
  // Words that must survive extraction intact; ligature damage shows up here.
  const haystack = JSON.stringify(data).toLowerCase()
  for (const w of ['configuration', 'workflows', 'offline', 'office']) {
    if (haystack.includes(w)) keywords.push(w)
  }
  for (const k of adKeywords) {
    const known = keywords.some((x) => x.toLowerCase() === k.toLowerCase())
    if (k.length > 2 && !known) keywords.push(k)
  }

  const headings = ['SUMMARY', 'SKILLS', 'WORK EXPERIENCE']
  if (data.training?.length) headings.push('TRAINING')
  if (data.projects?.length) headings.push('PROJECTS')
  if (data.languages?.length) headings.push('LANGUAGES')

  const contact = [data.email, data.phone, data.location, data.linkedin, data.github].filter(
    (c): c is string => Boolean(c),
  )

  const pairs: Expectations['pairs'] = []
  for (const job of data.work ?? []) {
    // Kept even when empty: check [7] must FAIL a job it cannot verify
    // rather than have it silently drop out of the comparison.
    pairs.push([job.company ?? '', job.start ?? ''])
  }

  return { email: data.email || null, keywords, headings, contact, pairs }
}
