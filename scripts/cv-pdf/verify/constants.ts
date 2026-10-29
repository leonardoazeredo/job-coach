import { MAX_PT, MIN_PT } from '../fit.ts'

// Imported, not copied: the app's fit band and the verifier's accepted band
// must not drift apart.
export const BODY_PT_MIN = MIN_PT
export const BODY_PT_MAX = MAX_PT
// The name is 1.8em of the largest body size.
export const TEXT_PT_MAX = 1.8 * MAX_PT
// 48px in the `@page` margin of src/cv/cv.css: 0.5in top and bottom on every page.
export const PAGE_MARGIN_PT = 36
// The app aims for a half-full last page (MIN_LAST_FILL in fit.ts); this is the
// verifier's tolerance, since it measures text extents, not layout boxes.
export const LAST_PAGE_MIN_FILL = 0.45

export const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
}

// The headings CvDocument renders, as they appear in the text layer.
export const SECTION_HEADINGS: readonly string[] = [
  'PROFESSIONAL SUMMARY',
  'CORE SKILLS',
  'WORK EXPERIENCE',
  'TRAINING',
  'PROJECTS',
  'EDUCATION',
  'LANGUAGES',
]

// A corrupt PDF can make an extractor spin; the verifier must fail, not hang.
// Shared by the poppler subprocesses and the pdf.js / MuPDF worker threads.
export const EXTRACT_TIMEOUT_MS = 60_000
