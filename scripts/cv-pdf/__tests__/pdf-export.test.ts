import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { type CvData, CvDataSchema } from '../../lib/cv-schema.ts'
import { ExportError, type ExportTools, type PagePrinter, runExport } from '../pdf-export.ts'
import { expectations } from '../verify/expectations.ts'
import type { PdfReader } from '../verify/reader.ts'

// The run only stats the printed file; every read of its content goes to the fake reader.
const DIR = mkdtempSync(join(tmpdir(), 'pdf-export-test-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
const OUT = join(DIR, 'cv.pdf')

// The run never reads the CV itself, only hands it to the printer and the expectations.
const CV: CvData = CvDataSchema.parse(
  JSON.parse(readFileSync(new URL('../verify/testdata/sample-cv.json', import.meta.url), 'utf8')),
)

const PROSE =
  'Built and ran the analytical engine for a team of engineers and mathematicians. '.repeat(8)
// Everything the checks look for, so the clean run passes without a real PDF.
const EXP = expectations(CV)
const CLEAN_TEXT = [
  ...EXP.contact,
  ...EXP.headings,
  ...EXP.keywords,
  ...EXP.pairs.map(([company, start]) => `${company} ${start}`),
  PROSE,
].join('\n')

const printer = (
  result: { fittedPages: number | undefined; mounted: boolean },
  lines: string[] = ['  [1/4] building'],
): PagePrinter => ({
  async print(_cv, out, log) {
    for (const l of lines) log(l)
    writeFileSync(out, 'x')
    return result
  },
})

const reader = (pages = 1, text = CLEAN_TEXT): PdfReader => ({
  info: async () => ({ pages, size: '595 x 842 pts (A4)', tagged: 'yes' }),
  pageText: async () => '',
  textInEveryEngine: async () => [
    { name: 'poppler', text, streamOrder: false },
    { name: 'pdfjs', text, streamOrder: false },
    { name: 'mupdf', text, streamOrder: false },
  ],
  glyphSizes: async () => new Map([[10, 100]]),
  linkTargets: async () => [{ uri: 'mailto:ada@example.com' }],
})

const run = async (tools: ExportTools) => {
  const lines: string[] = []
  let error: unknown
  try {
    await runExport(tools, { cv: CV, keywords: [], pdf: OUT, log: (l) => lines.push(l) })
  } catch (e) {
    error = e
  }
  return { lines, error }
}

describe('runExport on a fake page printer and PDF reader', () => {
  it('prints, checks the fit, verifies and ends with Done', async () => {
    const { lines, error } = await run({
      printer: printer({ fittedPages: 1, mounted: true }),
      reader: reader(),
    })
    assert.equal(error, undefined)
    assert.deepEqual(lines.slice(0, 2), [
      '  [1/4] building',
      '        fit: 1 page(s), matches the PDF',
    ])
    assert.equal(lines[2], '  [4/4] verifying the text layer\n')
    assert.equal(lines.at(-1), `  Done: ${OUT}`)
  })

  it('fails the export when a check fails', async () => {
    const { lines, error } = await run({
      printer: printer({ fittedPages: 1, mounted: true }),
      reader: reader(1, 'nothing useful'),
    })
    assert.ok(error instanceof ExportError)
    assert.equal(error.message, 'the PDF was written but failed verification. Do not send it.')
    assert.ok(!lines.some((l) => l.startsWith('  Done:')))
  })

  it('refuses a fitted page count that differs from the PDF', async () => {
    const { lines, error } = await run({
      printer: printer({ fittedPages: 1, mounted: true }),
      reader: reader(2),
    })
    assert.ok(error instanceof ExportError)
    assert.equal(error.message, 'the preview fitted 1 page(s) but the PDF has 2. Do not send it.')
    assert.ok(!lines.some((l) => l.includes('[4/4]')))
  })

  it('refuses a page that mounted but reported no fit', async () => {
    const { error } = await run({
      printer: printer({ fittedPages: undefined, mounted: true }),
      reader: reader(),
    })
    assert.ok(error instanceof ExportError)
    assert.equal(
      error.message,
      'the page mounted but reported no fit (data-fit-pages missing): the fit did not run. Do not send it.',
    )
  })

  it('goes on when the page neither mounted nor reported a fit', async () => {
    const { lines, error } = await run({
      printer: printer({ fittedPages: undefined, mounted: false }),
      reader: reader(),
    })
    assert.equal(error, undefined)
    assert.ok(lines.includes('        fit: not reported by the page; page agreement not checked'))
    assert.equal(lines.at(-1), `  Done: ${OUT}`)
  })

  it('stops when the reader cannot read the PDF', async () => {
    const broken = { ...reader(), info: async () => Promise.reject(new Error('pdfinfo failed')) }
    const { error } = await run({
      printer: printer({ fittedPages: 1, mounted: true }),
      reader: broken,
    })
    assert.match(String(error), /pdfinfo failed/)
  })
})
