import { LIGATURES } from './constants.ts'
import type { CheckResult, EngineText } from './types.ts'

export function spaceRatio(text: string): number {
  if (!text) return 0
  let spaces = 0
  for (const ch of text) if (ch === ' ') spaces++
  return spaces / [...text].length
}

/**
 * Stream-order extraction can lose the gap between separately written runs
 * ("React,ReactNative"), so phrase matching would fail because of the
 * extractor, not the CV. Text with no words (empty or whitespace-only) counts as
 * usable and is judged by the checks themselves.
 */
export function streamIsUsable(text: string): boolean {
  return !/\S/.test(text) || spaceRatio(text) > 0.05
}

const NO_GAPS = 'no word gaps'

// Only the stream-order engine (poppler -raw) is excused for gapless text,
// because its output drops word gaps by design. A gapless pdf.js or MuPDF
// result means the PDF's text layer lacks the gaps, so it is a failure.
function skipsPhraseMatching(e: EngineText): boolean {
  return e.streamOrder && !streamIsUsable(e.text)
}

function lacksGaps(e: EngineText): boolean {
  return !e.streamOrder && !streamIsUsable(e.text)
}

// extractAll keeps a failed engine in the list as `<error ...>`. That text
// contains no ligature or invisible characters, so scanning it would pass
// checks [1] and [2] for an engine that read nothing.
function isErrored(e: EngineText): boolean {
  return e.text.startsWith('<error ')
}

function erroredLine(e: EngineText): string {
  const reason = e.text.replace(/^<error /, '').replace(/>$/, '')
  return `FAIL ${e.name}: extraction error: ${reason}`
}

const LIGATURE_CHARS = Object.keys(LIGATURES)

export function checkLigatures(texts: EngineText[]): CheckResult {
  const lines: string[] = []
  let failures = 0
  for (const e of texts) {
    if (isErrored(e)) {
      failures++
      lines.push(erroredLine(e))
      continue
    }
    const { name, text } = e
    let count = 0
    for (const c of text) if (LIGATURE_CHARS.includes(c)) count++
    if (count > 0) {
      failures++
      const words = [
        ...new Set(
          (text.match(/\S+/g) ?? []).filter((w) => [...w].some((c) => LIGATURE_CHARS.includes(c))),
        ),
      ]
        .sort()
        .slice(0, 6)
      lines.push(`FAIL ${name}: ${count} occurrences -> ${JSON.stringify(words)}`)
    } else {
      lines.push(`ok   ${name}`)
    }
  }
  return { failures, lines }
}

export function checkInvisibleChars(allTexts: EngineText[]): CheckResult {
  const lines: string[] = []
  let failures = 0
  // One failure per errored engine, however many characters it would have been
  // checked for.
  for (const e of allTexts.filter(isErrored)) {
    failures++
    lines.push(erroredLine(e))
  }
  const texts = allTexts.filter((e) => !isErrored(e))
  // With no usable text, "no soft hyphen" would be a claim about nothing.
  if (texts.length === 0) {
    if (failures === 0) {
      failures++
      lines.push('FAIL no engine produced text to scan')
    }
    return { failures, lines }
  }
  for (const [label, ch] of [
    ['soft hyphen', '\u00ad'],
    ['nbsp', '\u00a0'],
  ] as const) {
    const found = texts
      .filter((e) => e.text.includes(ch))
      .map((e) => `${e.name}: ${e.text.split(ch).length - 1}`)
    if (found.length > 0) {
      failures++
      lines.push(`FAIL ${label}: {${found.join(', ')}}`)
    } else {
      lines.push(`ok   no ${label}`)
    }
  }
  return { failures, lines }
}

export function checkHeadings(texts: EngineText[], headings: string[]): CheckResult {
  const lines: string[] = []
  let failures = 0
  for (const e of texts) {
    if (isErrored(e)) {
      failures++
      lines.push(erroredLine(e))
      continue
    }
    if (skipsPhraseMatching(e)) {
      lines.push(
        `skip ${e.name}: stream-order output has no word gaps (${spaceRatio(e.text).toFixed(3)} spaces/char); see streamIsUsable()`,
      )
      continue
    }
    if (lacksGaps(e)) {
      failures++
      lines.push(`FAIL ${e.name}: ${NO_GAPS} (${spaceRatio(e.text).toFixed(3)} spaces/char)`)
      continue
    }
    const spaced = (e.text.match(/\b(?:[A-Z] ){3,}[A-Z]\b/g) ?? []).slice(0, 2)
    const upper = e.text.toUpperCase().replaceAll('\n', ' ')
    const missed = headings.filter((h) => !upper.includes(h))
    if (spaced.length > 0 || missed.length > 0) {
      failures++
      lines.push(
        `FAIL ${e.name}: spaced-out=${JSON.stringify(spaced)} missing=${JSON.stringify(missed)}`,
      )
    } else {
      lines.push(`ok   ${e.name}`)
    }
  }
  return { failures, lines }
}

// Loose enough for normal stream-order variance, tight enough to catch the
// system-ui class, whose gaps only the stream order loses. The measurements
// behind it are in verify/testdata/README.md.
const STREAM_GAP_RATIO_MIN = 0.5

/**
 * Stream-order output is skipped by checks [3] and [4] when it has no gaps, so a
 * PDF whose producer-order text lost its word spaces (the system-ui class) would
 * pass them. The positional engines read the same page without that loss; a
 * stream-order engine with under half the spaces per character of the
 * least-spaced positional engine shows it.
 */
export function checkStreamGaps(texts: EngineText[]): CheckResult {
  const streams = texts.filter((e) => e.streamOrder && !isErrored(e))
  const reference = texts
    .filter((e) => !e.streamOrder && !isErrored(e) && /\S/.test(e.text) && streamIsUsable(e.text))
    .map((e) => spaceRatio(e.text))
  if (streams.length === 0 || reference.length === 0) return { failures: 0, lines: [] }
  const floor = Math.min(...reference)
  const lines: string[] = []
  let failures = 0
  for (const e of streams) {
    const own = spaceRatio(e.text)
    const ratio = own / floor
    if (ratio < STREAM_GAP_RATIO_MIN) {
      failures++
      lines.push(
        `FAIL ${e.name}: word gaps lost: ${own.toFixed(3)} spaces/char against ${floor.toFixed(3)} in the positional engines`,
      )
    } else {
      lines.push(
        `ok   word gaps: ${e.name} has ${ratio.toFixed(2)}x the spaces of the positional engines`,
      )
    }
  }
  return { failures, lines }
}

export function checkKeywords(texts: EngineText[], keywords: string[]): CheckResult {
  const lines: string[] = []
  let failures = 0
  let failed = false
  let checked = 0
  for (const e of texts) {
    if (isErrored(e)) {
      failures++
      lines.push(erroredLine(e))
      continue
    }
    if (skipsPhraseMatching(e)) {
      lines.push(`skip ${e.name}: no word gaps in stream order, cannot match phrases`)
      continue
    }
    if (lacksGaps(e)) {
      failed = true
      lines.push(`FAIL ${e.name}: ${NO_GAPS} (${spaceRatio(e.text).toFixed(3)} spaces/char)`)
      continue
    }
    checked++
    // A multi-word term wrapped across lines is not damage.
    const low = e.text.replace(/\s+/g, ' ').toLowerCase()
    const gone = keywords.filter((k) => !low.includes(k.toLowerCase()))
    if (gone.length > 0) {
      failed = true
      lines.push(`FAIL ${e.name}: missing ${JSON.stringify(gone)}`)
    } else {
      lines.push(`ok   ${e.name}: all found`)
    }
  }
  if (failed) failures++
  if (checked < 3) {
    failures++
    lines.push(
      `FAIL only ${checked} engine(s) produced matchable text; the text layer may be unusable to a real parser`,
    )
  }
  return { failures, lines }
}
