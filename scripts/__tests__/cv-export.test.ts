import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type ChromePrinterDeps,
  chromePrinter,
  type ExportOutcome,
  exportCv,
  type PdfPrinter,
  type PrintJob,
  stalePdfProblem,
} from '../lib/cv-export.ts'
import { type TempRepo, tempRepo, type WorkedExample } from './temp-repo.ts'

describe('stalePdfProblem', () => {
  let dir: string
  let pdf: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cv-export-'))
    pdf = join(dir, 'cv.pdf')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts a non-empty PDF written during the run', () => {
    const started = Date.now()
    writeFileSync(pdf, '%PDF-1.7')
    expect(stalePdfProblem(pdf, started)).toBeUndefined()
  })

  it('reports a missing PDF', () => {
    expect(stalePdfProblem(pdf, Date.now())).toMatch(/no PDF/)
  })

  it('reports a PDF left over from an earlier export', () => {
    writeFileSync(pdf, '%PDF-1.7')
    const hourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(pdf, hourAgo, hourAgo)
    expect(stalePdfProblem(pdf, Date.now())).toMatch(/not rewritten/)
  })

  it('reports an empty PDF', () => {
    const started = Date.now()
    writeFileSync(pdf, '')
    expect(stalePdfProblem(pdf, started)).toMatch(/empty/)
  })
})

type Behaviour = 'writes' | 'skips' | 'empty' | 'fails'

// Stands in for Chrome and poppler, which are not installed on every machine.
const fakePrinter = (behaviour: Behaviour, unavailable?: string) => {
  const calls: PrintJob[] = []
  const printer: PdfPrinter = {
    unavailable: () => unavailable,
    print: async (job) => {
      calls.push(job)
      if (behaviour === 'writes') writeFileSync(job.pdf, '%PDF-1.7')
      if (behaviour === 'empty') writeFileSync(job.pdf, '')
      return { ok: behaviour !== 'fails', report: `verify: ${behaviour}\n` }
    },
  }
  return { calls, printer }
}

describe('exportCv', () => {
  let repo: TempRepo
  let larkspur: WorkedExample
  const run = (printer: PdfPrinter): Promise<ExportOutcome> =>
    exportCv({ workspace: repo.workspace(), slug: larkspur.slug, printer })

  beforeEach(() => {
    repo = tempRepo()
    larkspur = repo.workedExample()
  })
  afterEach(() => repo.dispose())

  it('accepts a fresh PDF and keeps the report in verify.txt', async () => {
    const outcome = await run(fakePrinter('writes').printer)
    expect(outcome).toMatchObject({ kind: 'ok', report: 'verify: writes\n' })
    expect(larkspur.read('cv/verify.txt')).toBe('verify: writes\n')
    expect(existsSync(larkspur.path('cv/cv.json'))).toBe(true)
  })

  it('refuses a printer that succeeds without writing the PDF', async () => {
    const outcome = await run(fakePrinter('skips').printer)
    expect(outcome).toMatchObject({ kind: 'stale-pdf', problem: expect.stringMatching(/no PDF/) })
  })

  it('refuses a printer that succeeds and leaves an old PDF in place', async () => {
    const { pdf } = repo.workspace().roleCv(larkspur.slug).files
    writeFileSync(pdf, '%PDF-1.7')
    const hourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(pdf, hourAgo, hourAgo)
    const outcome = await run(fakePrinter('skips').printer)
    expect(outcome).toMatchObject({
      kind: 'stale-pdf',
      problem: expect.stringMatching(/not rewritten/),
    })
  })

  it('refuses an empty PDF', async () => {
    const outcome = await run(fakePrinter('empty').printer)
    expect(outcome).toMatchObject({ kind: 'stale-pdf', problem: expect.stringMatching(/empty/) })
  })

  it('reports a failed print and still writes verify.txt', async () => {
    const outcome = await run(fakePrinter('fails').printer)
    expect(outcome).toMatchObject({ kind: 'print-failed', report: 'verify: fails\n' })
    expect(larkspur.read('cv/verify.txt')).toBe('verify: fails\n')
  })

  it('never calls the printer when the lint finds errors', async () => {
    larkspur.writeVariant((v) => {
      v.role = 'other-role'
    })
    const fake = fakePrinter('writes')
    const outcome = await run(fake.printer)
    expect(outcome.kind).toBe('lint-blocked')
    expect(outcome.problems).toContainEqual(expect.objectContaining({ level: 'error' }))
    expect(fake.calls).toEqual([])
    expect(existsSync(larkspur.path('cv/cv.json'))).toBe(false)
  })

  it('never calls the printer when cv.json cannot be written', async () => {
    mkdirSync(larkspur.path('cv/cv.json'))
    const fake = fakePrinter('writes')
    const outcome = await run(fake.printer)
    expect(outcome.kind).toBe('lint-blocked')
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringMatching(/^cv\/cv\.json/) }),
    )
    expect(fake.calls).toEqual([])
  })

  it('never calls the printer when requirements.yaml is missing', async () => {
    larkspur.remove('requirements.yaml')
    const fake = fakePrinter('writes')
    const outcome = await run(fake.printer)
    expect(outcome.kind).toBe('lint-blocked')
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'requirements.yaml is missing' }),
    )
    expect(fake.calls).toEqual([])
  })

  it('returns the outcome with a problem when verify.txt cannot be written', async () => {
    mkdirSync(larkspur.path('cv/verify.txt'))
    const outcome = await run(fakePrinter('writes').printer)
    expect(outcome).toMatchObject({ kind: 'ok', report: 'verify: writes\n' })
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: expect.stringMatching(/^cv\/verify\.txt could not be written: EISDIR/),
      }),
    )
  })

  it('stops before the lint when the printer is unavailable', async () => {
    const fake = fakePrinter('writes', 'no Chrome here')
    expect(await run(fake.printer)).toEqual({
      kind: 'printer-missing',
      reason: 'no Chrome here',
      problems: [],
    })
    expect(fake.calls).toEqual([])
  })

  it('hands the printer a keywords.txt holding only keywords that survive in the CV', async () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.keywords.push('Zanzibar')
    })
    const fake = fakePrinter('writes')
    await run(fake.printer)
    const [job] = fake.calls
    expect(job).toMatchObject({
      cvJson: larkspur.path('cv/cv.json'),
      keywords: larkspur.path('cv/keywords.txt'),
    })
    const keywords = larkspur.read('cv/keywords.txt').trim().split('\n')
    const cv = larkspur.read('cv/cv.json').toLowerCase()
    expect(keywords).not.toContain('Zanzibar')
    expect(keywords.length).toBeGreaterThan(0)
    for (const k of keywords) expect(cv).toContain(k.toLowerCase())
  })
})

describe('chromePrinter', () => {
  const job: PrintJob = { cvJson: 'a/cv.json', keywords: 'a/keywords.txt', pdf: 'a/out.pdf' }
  const machine = (over: Partial<ChromePrinterDeps> = {}): Partial<ChromePrinterDeps> => ({
    chrome: () => ({ path: '/fake/chrome' }),
    poppler: () => ({ pdftotext: '/fake/pdftotext', pdfinfo: '/fake/pdfinfo' }),
    platform: 'darwin',
    ...over,
  })

  it('is available with Chrome and poppler', () => {
    expect(chromePrinter(machine()).unavailable()).toBeUndefined()
  })

  it('says how to set CHROME_PATH when Chrome is missing', () => {
    const printer = chromePrinter(
      machine({ chrome: () => ({ error: 'install Chrome or set CHROME_PATH' }) }),
    )
    expect(printer.unavailable()).toMatch(/CHROME_PATH/)
  })

  it('says how to install poppler on macOS and Linux', () => {
    const missing = { poppler: () => ({ missing: ['pdftotext', 'pdfinfo'] }) }
    expect(chromePrinter(machine(missing)).unavailable()).toMatch(/brew install poppler/)
    expect(chromePrinter(machine({ ...missing, platform: 'linux' })).unavailable()).toMatch(
      /apt install poppler-utils/,
    )
  })

  it('passes the job and the browser path to the exporter and returns its log', async () => {
    const seen: unknown[] = []
    const printer = chromePrinter(
      machine({
        exportPdf: async (opts) => {
          seen.push(opts.cvJson, opts.keywordsFile, opts.pdf, opts.chrome)
          opts.log('printed')
        },
      }),
    )
    expect(await printer.print(job)).toEqual({ ok: true, report: 'printed\n' })
    expect(seen).toEqual(['a/cv.json', 'a/keywords.txt', 'a/out.pdf', '/fake/chrome'])
  })

  it('turns an exporter failure into a failed run that keeps the log and the reason', async () => {
    const printer = chromePrinter(
      machine({
        exportPdf: async (opts) => {
          opts.log('building')
          throw new Error('Chrome did not write a PDF within 60s')
        },
      }),
    )
    expect(await printer.print(job)).toEqual({
      ok: false,
      report: 'building\nERROR: Chrome did not write a PDF within 60s\n',
    })
  })
})
