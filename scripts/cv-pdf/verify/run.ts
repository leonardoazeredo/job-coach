import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { BODY_PT_MAX, BODY_PT_MIN, TEXT_PT_MAX } from './constants.ts'
import { PopplerMissingError } from './poppler.ts'
import type { PdfReader } from './reader.ts'
import { formatResult, section } from './report.ts'
import {
  checkContact,
  checkJobDates,
  checkPageBalance,
  checkTextOnce,
  checkTextSizes,
  describeLinks,
} from './structureChecks.ts'
import {
  checkHeadings,
  checkInvisibleChars,
  checkKeywords,
  checkLigatures,
  checkStreamGaps,
} from './textChecks.ts'
import type { CheckResult, Expectations } from './types.ts'

// Greenhouse's attachment limit.
const SIZE_CEILING_BYTES = 2.5 * 1024 * 1024
const RULE = '='.repeat(72)
// The check modules return unindented lines; the report nests them under their
// section heading.
const DETAIL_INDENT = '      '

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface PageMeasure {
  height?: number
  yMax: number[]
  lastLines: string[]
}

async function measurePages(reader: PdfReader, pdf: string, pages: number): Promise<PageMeasure> {
  const measure: PageMeasure = { yMax: [], lastLines: [] }
  if (pages <= 1) return measure
  try {
    const bbox = await reader.pageText(pdf, pages, { bbox: true })
    const height = /<page width="[\d.]+" height="([\d.]+)"/.exec(bbox)?.[1]
    if (height !== undefined) measure.height = Number(height)
    measure.yMax = [...bbox.matchAll(/yMax="([\d.]+)"/g)].map((m) => Number(m[1]))
  } catch (e) {
    if (e instanceof PopplerMissingError) throw e
    // Left empty: check [9] then reports that the page could not be measured.
  }
  // One entry per non-final page. A page that cannot be read contributes a
  // blank line, which can never be a heading.
  for (let i = 1; i < pages; i++) {
    try {
      const text = await reader.pageText(pdf, i)
      const nonBlank = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      measure.lastLines.push(nonBlank.at(-1) ?? '')
    } catch (e) {
      if (e instanceof PopplerMissingError) throw e
      measure.lastLines.push('')
    }
  }
  return measure
}

/**
 * Runs the ten checks against one PDF and returns the number of failures. A
 * missing file counts as one failure and skips the checks. Every read of the
 * PDF's content goes through `reader`; the file's existence and size are checked
 * on disk. A PopplerMissingError from a poppler read propagates, and the caller
 * owns the exit code.
 */
export async function verifyPdf(
  pdf: string,
  exp: Expectations,
  reader: PdfReader,
  log: (line: string) => void = console.log,
): Promise<number> {
  log(`\n${RULE}\n${basename(pdf)}\n${RULE}`)
  if (!existsSync(pdf)) {
    log('  MISSING FILE')
    return 1
  }

  let failures = 0
  const emit = (result: CheckResult): void => {
    failures += result.failures
    for (const line of result.lines) log(DETAIL_INDENT + line)
  }

  let pages = 0
  let infoError: string | undefined
  try {
    const info = await reader.info(pdf)
    pages = info.pages
    log(`  pages=${info.pages || '?'}  size=${info.size}  tagged=${info.tagged}`)
  } catch (e) {
    if (e instanceof PopplerMissingError) throw e
    infoError = message(e)
    log('  pages=?  size=?  tagged=?')
  }
  const bytes = statSync(pdf).size
  log(
    `  file size = ${(bytes / 1024).toFixed(0)} KB (${bytes < SIZE_CEILING_BYTES ? 'OK' : 'OVER Greenhouse 2.5MB ceiling'})`,
  )

  const texts = await reader.textInEveryEngine(pdf)

  log(section(1, 'ligature glyphs (U+FB00-FB06) per engine'))
  emit(checkLigatures(texts))

  log(section(2, 'soft hyphen U+00AD and non-breaking space U+00A0'))
  emit(checkInvisibleChars(texts))

  log(section(3, 'section headings readable (letter-spacing damage)'))
  emit(checkHeadings(texts, exp.headings))
  emit(checkStreamGaps(texts))

  log(section(4, `keywords survive in every engine (${exp.keywords.length} tested)`))
  emit(checkKeywords(texts, exp.keywords))

  const poppler = texts.find((t) => t.name === 'poppler')?.text ?? ''

  log(section(5, 'contact details present as visible text'))
  emit(checkContact(poppler, exp.contact))

  log(section(6, 'link annotations'))
  try {
    emit(describeLinks(await reader.linkTargets(pdf)))
  } catch (e) {
    emit(describeLinks([], message(e)))
  }

  log(section(7, 'start date adjacent to its company (poppler)'))
  emit(checkJobDates(poppler, exp.pairs))

  log(section(8, `text size band (${BODY_PT_MIN}-${BODY_PT_MAX}pt body, ${TEXT_PT_MAX}pt max)`))
  try {
    emit(checkTextSizes(await reader.glyphSizes(pdf)))
  } catch (e) {
    emit(checkTextSizes(null, message(e)))
  }

  log(section(9, 'page balance'))
  // checkPageBalance reports 0 pages as a passing single page, so an unreadable
  // count must fail here.
  if (!Number.isInteger(pages) || pages < 1) {
    emit({
      failures: 1,
      lines: [
        `FAIL could not read the page count${infoError === undefined ? '' : `: ${infoError}`}`,
      ],
    })
  } else {
    const m = await measurePages(reader, pdf, pages)
    emit(
      checkPageBalance({
        pages,
        lastPageHeight: m.height,
        lastPageYMax: m.yMax,
        lastLinePerPage: m.lastLines,
      }),
    )
  }

  log(section(10, 'text appears once (poppler)'))
  emit(checkTextOnce(poppler, exp.email))

  log(formatResult(failures))
  return failures
}

// `verify` stands in for verifyPdf so a test can make one file fail.
export interface VerifyEachOptions {
  log?: (line: string) => void
  verify?: typeof verifyPdf
}

/**
 * Verifies each PDF in turn and sums the failures. An unexpected error on one
 * file is reported as a failure of that file and does not stop the rest;
 * PopplerMissingError still propagates, since no file can be verified without it.
 */
export async function verifyEach(
  pdfs: string[],
  exp: Expectations,
  reader: PdfReader,
  { log = console.log, verify = verifyPdf }: VerifyEachOptions = {},
): Promise<number> {
  let total = 0
  for (const pdf of pdfs) {
    try {
      total += await verify(pdf, exp, reader, log)
    } catch (e) {
      if (e instanceof PopplerMissingError) throw e
      log(`\n  FAIL could not verify ${pdf}: ${message(e)}`)
      total += 1
    }
  }
  return total
}
