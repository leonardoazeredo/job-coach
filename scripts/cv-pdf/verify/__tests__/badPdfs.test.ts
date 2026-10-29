import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, vi } from 'vitest'
import type { CvData } from '../../types.ts'
import { expectations } from '../expectations.ts'
import { verifyPdf } from '../run.ts'
import type { Expectations } from '../types.ts'
import { hasPoppler } from './hasPoppler.ts'

// One PDF per failure class, printed by Chrome from the HTML beside it; see
// verify/testdata/README.md.
const BAD = fileURLToPath(new URL('../testdata/bad/', import.meta.url))
// Fixtures that add content to the shared CV have their own data file, so the
// expectations describe what each PDF actually contains.
const OWN_DATA = new Set(['stranded-heading', 'stub-last-page'])

function expectationsFor(name: string): Expectations {
  const file = OWN_DATA.has(name) ? `${name}.json` : 'cv.json'
  return expectations(JSON.parse(readFileSync(join(BAD, file), 'utf8')) as Partial<CvData>)
}
vi.setConfig({ testTimeout: 60_000 })

type Engine = 'poppler' | 'poppler -layout' | 'poppler -raw' | 'pdf.js' | 'mupdf'
const ENGINE_LINE = /^(FAIL|ok|skip) +(poppler -layout|poppler -raw|poppler|pdf\.js|mupdf)(?::|$)/

interface Report {
  failures: number
  /** Detail lines of each numbered check, trimmed. */
  sections: Map<number, string[]>
}

const reports = new Map<string, Promise<Report>>()

// Each PDF is verified once and shared by the tests that read its report.
function report(name: string): Promise<Report> {
  let r = reports.get(name)
  if (!r) {
    r = (async () => {
      const lines: string[] = []
      const failures = await verifyPdf(join(BAD, `${name}.pdf`), expectationsFor(name), (l) =>
        lines.push(...l.split('\n')),
      )
      const sections = new Map<number, string[]>()
      let current: string[] | null = null
      for (const line of lines) {
        const head = /^ {2}\[(\d+)\] /.exec(line)
        if (head) {
          current = []
          sections.set(Number(head[1]), current)
        } else if (line.startsWith('  RESULT:')) {
          current = null
        } else if (current && line.trim()) {
          current.push(line.trim())
        }
      }
      return { failures, sections }
    })()
    reports.set(name, r)
  }
  return r
}

function failingChecks(r: Report): number[] {
  return [...r.sections]
    .filter(([, lines]) => lines.some((l) => l.startsWith('FAIL')))
    .map(([n]) => n)
}

/** Engines whose own line in a per-engine check (1, 3 or 4) is a FAIL. */
function failingEngines(r: Report, check: number): Engine[] {
  const failing: Engine[] = []
  for (const line of r.sections.get(check) ?? []) {
    const m = ENGINE_LINE.exec(line)
    if (m && m[1] === 'FAIL') failing.push(m[2] as Engine)
  }
  return failing.sort()
}

function line(r: Report, check: number, prefix: string): string {
  const found = (r.sections.get(check) ?? []).find((l) => l.startsWith(prefix))
  assert.ok(
    found,
    `no [${check}] line starting ${JSON.stringify(prefix)}: ${JSON.stringify(r.sections.get(check))}`,
  )
  return found
}

describe.skipIf(!hasPoppler)('bad PDFs fail the check their class targets', () => {
  it('control passes every check', async () => {
    const r = await report('control')
    assert.deepEqual(failingChecks(r), [])
    assert.equal(r.failures, 0)
  })

  it('ligature glyphs: [1] and [4] fail in pdf.js and MuPDF', async () => {
    const r = await report('ligatures')
    assert.deepEqual(failingChecks(r), [1, 4])
    // poppler maps the ligature glyphs back to letters, as the research found.
    assert.deepEqual(failingEngines(r, 1), ['mupdf', 'pdf.js'])
    assert.match(line(r, 1, 'FAIL pdf.js:'), /workﬂows/)
    assert.deepEqual(failingEngines(r, 4), ['mupdf', 'pdf.js'])
    assert.match(line(r, 4, 'FAIL mupdf:'), /"workflows"/)
  })

  it('letter-spacing at the original 1.5px: [3] fails in poppler and pdf.js, not MuPDF', async () => {
    const r = await report('letter-spacing')
    assert.deepEqual(failingChecks(r), [3])
    // MuPDF treats the 1.5px letter-spacing gaps as letter gaps, not word gaps,
    // so it does not fail this class.
    assert.deepEqual(failingEngines(r, 3), ['pdf.js', 'poppler', 'poppler -layout'])
    assert.match(line(r, 3, 'FAIL pdf.js:'), /spaced-out=\["P R O F E S S I O N A L/)
  })

  it('letter-spacing at 4px: [3] fails in pdf.js, MuPDF and poppler -raw', async () => {
    const r = await report('letter-spacing-wide')
    assert.deepEqual(failingChecks(r), [3])
    assert.deepEqual(failingEngines(r, 3), ['mupdf', 'pdf.js', 'poppler -raw'])
    assert.match(line(r, 3, 'FAIL mupdf:'), /missing=\["SUMMARY","SKILLS","WORK EXPERIENCE"\]/)
  })

  // Only poppler -raw loses the word gaps, and checks [3] and [4] skip gapless
  // stream-order output by design (streamIsUsable). The gap-ratio sub-check of
  // [3] compares it with the positional engines instead.
  it('system-ui space loss: [3] fails poppler -raw on its gap ratio, and phrase matching still skips it', async () => {
    const r = await report('system-ui')
    assert.deepEqual(failingChecks(r), [3])
    assert.deepEqual(failingEngines(r, 3), ['poppler -raw'])
    assert.match(
      line(r, 3, 'FAIL poppler -raw:'),
      /word gaps lost: 0\.0\d\d spaces\/char against 0\.1\d\d/,
    )
    const skip = line(r, 3, 'skip poppler -raw:')
    assert.ok(Number(/\(([\d.]+) spaces\/char\)/.exec(skip)?.[1]) < 0.05, skip)
    line(r, 4, 'skip poppler -raw:')
    assert.deepEqual(failingEngines(r, 4), [])
  })

  // pdf.js 6.3 folds U+00A0 and drops U+00AD, so it sees neither. Chrome writes
  // the soft hyphen as a space glyph under /ActualText <FEFF00AD>, which MuPDF's
  // ignore-actualtext option reads as the space; poppler honours ActualText.
  it('invisible chars: [2] fails, soft hyphen via poppler and nbsp via MuPDF', async () => {
    const r = await report('invisible-chars')
    assert.deepEqual(failingChecks(r), [2, 4])
    assert.equal(
      line(r, 2, 'FAIL soft hyphen:'),
      'FAIL soft hyphen: {poppler: 1, poppler -layout: 1, poppler -raw: 1}',
    )
    assert.equal(line(r, 2, 'FAIL nbsp:'), 'FAIL nbsp: {mupdf: 2}')
  })

  it('sub-10pt body: [8] fails', async () => {
    const r = await report('small-body')
    assert.deepEqual(failingChecks(r), [8])
    line(r, 8, 'FAIL smallest 9pt is under 10pt')
    line(r, 8, 'FAIL body 9pt is outside 10-12pt')
  })

  it('stranded heading: [9] fails on the last line of page 1', async () => {
    const r = await report('stranded-heading')
    assert.deepEqual(failingChecks(r), [9])
    line(r, 9, 'FAIL heading "WORK EXPERIENCE" is the last line of page 1')
    assert.match(line(r, 7, 'ok   Vandelay Industries'), /June 2009/)
  })

  it('stub last page: [9] fails on fill', async () => {
    const r = await report('stub-last-page')
    assert.deepEqual(failingChecks(r), [9])
    assert.match(line(r, 9, 'FAIL page 2 is'), /^FAIL page 2 is \d+% full/)
    assert.match(line(r, 7, 'ok   Umbrella Systems'), /January 2012/)
    assert.deepEqual(failingEngines(r, 3), [])
  })

  it('doubled text: [10] fails', async () => {
    const r = await report('doubled-text')
    assert.deepEqual(failingChecks(r), [10])
    line(r, 10, 'FAIL "alex.example@example.com" occurs 2 times')
  })
})
