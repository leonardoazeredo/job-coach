import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cvExport } from '../cv-export.ts'
import { findingMissing } from '../cv-pdf/__tests__/fake-find.ts'
import { ExportError } from '../cv-pdf/export-pdf.ts'
import type { ExportTools, PagePrinter } from '../cv-pdf/pdf-export.ts'
import type { MissingTools } from '../cv-pdf/tools.ts'
import { expectations } from '../cv-pdf/verify/expectations.ts'
import type { PdfReader } from '../cv-pdf/verify/reader.ts'
import { type PrintJob, printWith } from '../lib/cv-export.ts'
import { CvDataSchema } from '../lib/cv-schema.ts'
import { EXIT } from '../lib/problem.ts'
import { type TempRepo, tempRepo, type WorkedExample } from './temp-repo.ts'

let repo: TempRepo
let larkspur: WorkedExample
const useExportRepo = () => {
  beforeEach(() => {
    repo = tempRepo()
    larkspur = repo.workedExample()
  })
  afterEach(() => repo.dispose())
}

describe('printWith', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-print-with-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const cvJson = fileURLToPath(new URL('../cv-pdf/verify/testdata/sample-cv.json', import.meta.url))
  const keywords = join(dir, 'keywords.txt')
  writeFileSync(keywords, '')
  const job = (name: string): PrintJob => ({ cvJson, keywords, pdf: join(dir, name) })

  const cv = CvDataSchema.parse(JSON.parse(readFileSync(cvJson, 'utf8')))
  const exp = expectations(cv)
  const prose =
    'Built and ran the analytical engine for a team of engineers and mathematicians. '.repeat(8)
  const clean = [
    ...exp.contact,
    ...exp.headings,
    ...exp.keywords,
    ...exp.pairs.map(([company, start]) => `${company} ${start}`),
    prose,
  ].join('\n')
  const reader: PdfReader = {
    info: async () => ({ pages: 1, size: 'A4', tagged: 'yes' }),
    pageText: async () => '',
    textInEveryEngine: async () =>
      ['poppler', 'pdfjs', 'mupdf'].map((name) => ({ name, text: clean, streamOrder: false })),
    glyphSizes: async () => new Map([[10, 100]]),
    linkTargets: async () => [{ uri: 'mailto:ada@example.com' }],
  }
  const printer = (print: PagePrinter['print']): ExportTools => ({ printer: { print }, reader })

  it('prints the job with the tools it is given and returns the log as the report', async () => {
    const seen: string[] = []
    const tools = printer(async (_cv, out, log) => {
      seen.push(out)
      log('printed')
      writeFileSync(out, 'x')
      return { fittedPages: 1, mounted: true }
    })
    const j = job('ok.pdf')
    const run = await printWith(tools)(j)
    expect(run.ok).toBe(true)
    expect(run.report).toMatch(/^printed\n/)
    expect(run.report).toContain(`Done: ${j.pdf}`)
    expect(seen).toEqual([j.pdf])
  })

  it('turns an export failure into a failed run that keeps the log and the reason', async () => {
    const tools = printer(async (_cv, _out, log) => {
      log('building')
      throw new ExportError('Chrome did not write a PDF within 60s')
    })
    expect(await printWith(tools)(job('fail.pdf'))).toEqual({
      ok: false,
      report: 'building\nERROR: Chrome did not write a PDF within 60s\n',
    })
  })

  it('turns any other error into its ERROR line too', async () => {
    const tools = printer(async () => {
      throw new Error('poppler vanished')
    })
    expect(await printWith(tools)(job('boom.pdf'))).toEqual({
      ok: false,
      report: 'ERROR: poppler vanished\n',
    })
  })
})

// The command looks for the tools first; a fake stands in for the lookup so these run on any
// machine. Only the missing cases are described: finding both is the real lookup's job.
describe('cvExport with a tool missing', () => {
  useExportRepo()
  const popplerGone = { names: ['pdftotext', 'pdfinfo'], install: 'brew install poppler' }
  const exportWith = (m: MissingTools, ...args: string[]) => {
    const { find, asked } = findingMissing(m)
    const run = repo.run((a, workspace) => cvExport(a, workspace, find), ...args)
    return { run, asked }
  }
  const nothingWritten = () => {
    for (const f of ['cv/cv.json', 'cv/keywords.txt', 'cv/verify.txt']) {
      expect(existsSync(larkspur.path(f))).toBe(false)
    }
  }

  it('names Chrome, exits 66 and writes nothing', async () => {
    const r = await exportWith({ chrome: 'install Chrome or set CHROME_PATH' }, larkspur.slug).run
    expect(r.code).toBe(EXIT.missing)
    expect(r.stderr).toBe('cv-export: install Chrome or set CHROME_PATH\n')
    nothingWritten()
  })

  it('says poppler is needed to verify, once with its install command, and exits 66', async () => {
    const r = await exportWith({ poppler: popplerGone }, larkspur.slug).run
    expect(r.code).toBe(EXIT.missing)
    expect(r.stderr).toBe(
      'cv-export: poppler is required to verify the PDF but pdftotext and pdfinfo could not be found; install with: brew install poppler\n',
    )
    nothingWritten()
  })

  it('names Chrome first when both are missing', async () => {
    const r = await exportWith({ chrome: 'no Chrome here', poppler: popplerGone }, larkspur.slug)
      .run
    expect(r.stderr).toBe('cv-export: no Chrome here\n')
  })

  it('checks the usage before looking for the tools', async () => {
    const { run, asked } = exportWith({ chrome: 'no Chrome here' })
    expect((await run).code).toBe(EXIT.usage)
    expect(asked).toEqual([])
  })
})
