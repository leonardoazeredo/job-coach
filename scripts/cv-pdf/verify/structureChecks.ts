import {
  BODY_PT_MAX,
  BODY_PT_MIN,
  LAST_PAGE_MIN_FILL,
  PAGE_MARGIN_PT,
  SECTION_HEADINGS,
  TEXT_PT_MAX,
} from './constants.ts'
import type { CheckResult, LinkTarget } from './types.ts'

// Size comparisons allow for the 0.1pt rounding of the glyph-size keys.
const SIZE_TOLERANCE_PT = 0.1
// The look-behind exists because a wrapped date can
// precede the company on the extracted line; the cost is that it can also match
// the previous entry's date when that sits within 40 chars.
const WINDOW_BEFORE = 40
// Long enough for a same-line date after "company, city, country |".
const WINDOW_AFTER = 160
// Enough of the window to see what was found instead of the date.
const NOT_ADJACENT_PREVIEW = 60

export function checkContact(popplerText: string, contact: string[]): CheckResult {
  const low = popplerText.toLowerCase()
  const missing = contact.filter((c) => !low.includes(c.toLowerCase()))
  if (missing.length > 0) {
    return { failures: 1, lines: [`FAIL missing: ${JSON.stringify(missing)}`] }
  }
  return { failures: 0, lines: [`ok   ${contact.length} contact fields in text layer`] }
}

// Links are optional. A link with no action (an internal jump or an annotation
// with no target) is only noted; every action other than /URI fails, /GoTo
// included, because a parser or reviewer's PDF viewer may act on it and a CV has
// no use for one. An unreadable annotation tree fails too: reporting it as
// "none" would pass a PDF whose links were never checked.
export function describeLinks(links: LinkTarget[], readError?: string): CheckResult {
  const lines: string[] = []
  let failures = 0
  if (readError !== undefined) {
    failures++
    lines.push(`FAIL could not read annotations: ${readError}`)
  }
  const shown: Array<string | null> = []
  for (const link of links) {
    if ('action' in link) {
      failures++
      lines.push(`FAIL link action /${link.action}: only /URI links belong in a CV`)
    } else if ('malformedUri' in link) {
      failures++
      lines.push('FAIL malformed /URI action: no target string')
    } else {
      shown.push('uri' in link ? link.uri : null)
    }
  }
  lines.push(shown.length > 0 ? JSON.stringify(shown) : 'none (fine if URLs are visible text)')
  return { failures, lines }
}

function occurrences(text: string, needle: string): number[] {
  // An empty needle matches everywhere; reporting it as absent is what keeps
  // the loop below finite and the pair visibly failing.
  if (needle === '') return []
  const found: number[] = []
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) return found
    found.push(at)
    // Non-overlapping, like re.finditer.
    from = at + needle.length
  }
}

// The date can sit on the company's own line or wrap onto a neighbouring one,
// so the window reaches both before and after the company.
export function checkJobDates(popplerText: string, pairs: Array<[string, string]>): CheckResult {
  // An explicit line, so a CV with no work section is not mistaken for a
  // check that ran and printed nothing.
  if (pairs.length === 0) return { failures: 0, lines: ['skip no work entries'] }
  const lines: string[] = []
  let failures = 0
  for (const [company, date] of pairs) {
    if (date === '') {
      // "" is a substring of every window, so it would pass vacuously.
      failures++
      lines.push(`FAIL ${JSON.stringify(company)} has an empty start date`)
      continue
    }
    const hits = occurrences(popplerText, company)
    if (hits.length === 0) {
      failures++
      lines.push(`FAIL ${JSON.stringify(company)} not found in the text layer at all`)
      continue
    }
    // The same company can appear twice with different dates, so any
    // occurrence carrying the date is a pass.
    const windows = hits.map((at) =>
      popplerText.slice(Math.max(0, at - WINDOW_BEFORE), at + company.length + WINDOW_AFTER),
    )
    const matched = windows.findIndex((w) => w.includes(date))
    const label = `${company.padEnd(34)} -> ${date.padEnd(16)}`
    if (matched >= 0) {
      lines.push(`ok   ${label} found near occurrence ${matched + 1} of ${hits.length}`)
    } else {
      failures++
      lines.push(
        `FAIL ${label} NOT adjacent: ${JSON.stringify(windows[0]?.slice(0, NOT_ADJACENT_PREVIEW))}`,
      )
    }
  }
  return { failures, lines }
}

/**
 * `sizes` maps pt (rounded to 0.1) to glyph count; null means the glyph walk
 * itself failed. A partial count says nothing reliable, so this reports the
 * read failure alone. `readError` is the reader's message, appended to the failure
 * line when `sizes` is null and ignored otherwise.
 */
export function checkTextSizes(sizes: Map<number, number> | null, readError?: string): CheckResult {
  if (sizes === null) {
    const why = readError === undefined ? '' : `: ${readError}`
    return { failures: 1, lines: [`FAIL could not read glyph sizes${why}`] }
  }
  if (sizes.size === 0) {
    return { failures: 1, lines: ['FAIL no glyphs found; cannot establish the text size'] }
  }
  const keys = [...sizes.keys()]
  const smallest = Math.min(...keys)
  const largest = Math.max(...keys)
  // Strict > keeps the first-seen size on a tie, provided the caller inserts
  // keys in first-sighting order.
  let body = keys[0] ?? 0
  for (const k of keys) if ((sizes.get(k) ?? 0) > (sizes.get(body) ?? 0)) body = k

  const lines = [`smallest ${smallest}pt, body ${body}pt, largest ${largest}pt`]
  const problems: string[] = []
  if (smallest < BODY_PT_MIN - SIZE_TOLERANCE_PT) {
    problems.push(`smallest ${smallest}pt is under ${BODY_PT_MIN}pt`)
  }
  if (!(BODY_PT_MIN - SIZE_TOLERANCE_PT <= body && body <= BODY_PT_MAX + SIZE_TOLERANCE_PT)) {
    problems.push(`body ${body}pt is outside ${BODY_PT_MIN}-${BODY_PT_MAX}pt`)
  }
  if (largest > TEXT_PT_MAX + SIZE_TOLERANCE_PT) {
    problems.push(`largest ${largest}pt is over ${TEXT_PT_MAX}pt`)
  }
  if (problems.length === 0) {
    lines.push('ok   within the band')
    return { failures: 0, lines }
  }
  for (const p of problems) lines.push(`FAIL ${p}`)
  return { failures: 1, lines }
}

export interface PageBalanceInput {
  pages: number
  /** Height in pt of the last page, from the bbox output. */
  lastPageHeight?: number | undefined
  /** yMax of every word on the last page. */
  lastPageYMax: number[]
  /** Last non-blank line of each non-final page, in page order (index 0 is page 1). */
  lastLinePerPage: string[]
}

// Fill is how far the lowest word reaches into the area between the top and
// bottom margins: (max yMax - margin) / (height - 2 * margin).
export function checkPageBalance(input: PageBalanceInput): CheckResult {
  const { pages, lastPageHeight, lastPageYMax, lastLinePerPage } = input
  if (pages <= 1) return { failures: 0, lines: ['ok   single page'] }

  const lines: string[] = []
  let failures = 0
  if (lastPageHeight !== undefined && lastPageYMax.length > 0) {
    const usable = lastPageHeight - 2 * PAGE_MARGIN_PT
    const fill = (Math.max(...lastPageYMax) - PAGE_MARGIN_PT) / usable
    const pct = `${(fill * 100).toFixed(0)}%`
    if (fill < LAST_PAGE_MIN_FILL) {
      failures++
      lines.push(`FAIL page ${pages} is ${pct} full; trim to drop the page or add content`)
    } else {
      lines.push(`ok   page ${pages} is ${pct} full`)
    }
  } else {
    failures++
    lines.push(`FAIL could not measure page ${pages}`)
  }
  // A heading ending a page is separated from the content it introduces.
  for (let i = 1; i < pages; i++) {
    const last = (lastLinePerPage[i - 1] ?? '').trim()
    if (last && SECTION_HEADINGS.includes(last.toUpperCase())) {
      failures++
      lines.push(`FAIL heading ${JSON.stringify(last)} is the last line of page ${i}`)
    }
  }
  return { failures, lines }
}

// A hidden measuring copy would double every line, so the email must occur once.
export function checkTextOnce(popplerText: string, email: string | null): CheckResult {
  if (!email) return { failures: 0, lines: ['skip no email in the data'] }
  const count = occurrences(popplerText.toLowerCase(), email.toLowerCase()).length
  if (count !== 1) {
    return {
      failures: 1,
      lines: [`FAIL ${JSON.stringify(email)} occurs ${count} times; expected once`],
    }
  }
  return { failures: 0, lines: [`ok   ${JSON.stringify(email)} occurs once`] }
}
