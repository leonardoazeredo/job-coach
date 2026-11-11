import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExportError, readCv } from '../cv-pdf/export-pdf.ts'
import {
  type ExportOutcome,
  exportCv,
  type PrintJob,
  type PrintRun,
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
const fakePrint = (behaviour: Behaviour) => {
  const calls: PrintJob[] = []
  const print = async (job: PrintJob): Promise<PrintRun> => {
    calls.push(job)
    if (behaviour === 'writes') writeFileSync(job.pdf, '%PDF-1.7')
    if (behaviour === 'empty') writeFileSync(job.pdf, '')
    return { ok: behaviour !== 'fails', report: `verify: ${behaviour}\n` }
  }
  return { calls, print }
}

let repo: TempRepo
let larkspur: WorkedExample
const run = (print: (job: PrintJob) => Promise<PrintRun>): Promise<ExportOutcome> =>
  exportCv({ workspace: repo.workspace(), slug: larkspur.slug, print })

// Each describe registers the hooks itself, since hooks only apply within their own describe.
const useExportRepo = () => {
  beforeEach(() => {
    repo = tempRepo()
    larkspur = repo.workedExample()
  })
  afterEach(() => repo.dispose())
}

describe('exportCv printer results', () => {
  useExportRepo()

  it('accepts a fresh PDF and keeps the report in verify.txt', async () => {
    const outcome = await run(fakePrint('writes').print)
    expect(outcome).toMatchObject({ kind: 'ok', report: 'verify: writes\n' })
    expect(larkspur.read('cv/verify.txt')).toBe('verify: writes\n')
    expect(existsSync(larkspur.path('cv/cv.json'))).toBe(true)
  })

  it('refuses a printer that succeeds without writing the PDF', async () => {
    const outcome = await run(fakePrint('skips').print)
    expect(outcome).toMatchObject({ kind: 'stale-pdf', problem: expect.stringMatching(/no PDF/) })
  })

  it('refuses a printer that succeeds and leaves an old PDF in place', async () => {
    const { pdf } = repo.workspace().roleCv(larkspur.slug).files
    writeFileSync(pdf, '%PDF-1.7')
    const hourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(pdf, hourAgo, hourAgo)
    const outcome = await run(fakePrint('skips').print)
    expect(outcome).toMatchObject({
      kind: 'stale-pdf',
      problem: expect.stringMatching(/not rewritten/),
    })
  })

  it('refuses an empty PDF', async () => {
    const outcome = await run(fakePrint('empty').print)
    expect(outcome).toMatchObject({ kind: 'stale-pdf', problem: expect.stringMatching(/empty/) })
  })

  it('reports a failed print and still writes verify.txt', async () => {
    const outcome = await run(fakePrint('fails').print)
    expect(outcome).toMatchObject({ kind: 'print-failed', report: 'verify: fails\n' })
    expect(larkspur.read('cv/verify.txt')).toBe('verify: fails\n')
  })
})

describe('exportCv blocked runs', () => {
  useExportRepo()

  it('never calls the print function when the lint finds errors', async () => {
    larkspur.writeVariant((v) => {
      v.role = 'other-role'
    })
    const fake = fakePrint('writes')
    const outcome = await run(fake.print)
    expect(outcome.kind).toBe('lint-blocked')
    expect(outcome.problems).toContainEqual(expect.objectContaining({ level: 'error' }))
    expect(fake.calls).toEqual([])
    expect(existsSync(larkspur.path('cv/cv.json'))).toBe(false)
  })

  it('never calls the print function when cv.json cannot be written', async () => {
    mkdirSync(larkspur.path('cv/cv.json'))
    const fake = fakePrint('writes')
    const outcome = await run(fake.print)
    expect(outcome.kind).toBe('lint-blocked')
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringMatching(/^cv\/cv\.json/) }),
    )
    expect(fake.calls).toEqual([])
  })

  it('never calls the print function when requirements.yaml is missing', async () => {
    larkspur.remove('requirements.yaml')
    const fake = fakePrint('writes')
    const outcome = await run(fake.print)
    expect(outcome.kind).toBe('lint-blocked')
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'requirements.yaml is missing' }),
    )
    expect(fake.calls).toEqual([])
  })
})

describe('exportCv outcome details', () => {
  useExportRepo()

  it('returns the outcome with a problem when verify.txt cannot be written', async () => {
    mkdirSync(larkspur.path('cv/verify.txt'))
    const outcome = await run(fakePrint('writes').print)
    expect(outcome).toMatchObject({ kind: 'ok', report: 'verify: writes\n' })
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: expect.stringMatching(/^cv\/verify\.txt could not be written: EISDIR/),
      }),
    )
  })

  it('hands the print function a keywords.txt holding only keywords that survive in the CV', async () => {
    larkspur.writeRequirements((_r1, r2) => {
      r2.keywords.push('Zanzibar')
    })
    const fake = fakePrint('writes')
    await run(fake.print)
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

describe('readCv', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-cv-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (body: unknown) => {
    const path = join(dir, 'cv.json')
    writeFileSync(path, JSON.stringify(body))
    return path
  }

  it('rejects a JSON object of the wrong shape, naming the file and the fields', () => {
    const path = write({ name: 'A', work: 'nope' })
    expect(() => readCv(path)).toThrow(ExportError)
    expect(() => readCv(path)).toThrow(new RegExp(`${path} is not a valid CV: .*work`))
  })

  it('rejects a file that is not JSON', () => {
    const path = join(dir, 'cv.json')
    writeFileSync(path, '{nope')
    expect(() => readCv(path)).toThrow(/is not valid JSON/)
  })
})
