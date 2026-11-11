import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, it, vi } from 'vitest'
import { CvDataSchema } from '../../lib/cv-schema.ts'
import { pdfFileName } from '../../lib/identity.ts'
import { exportPdfCommand } from '../export-pdf.ts'
import type { ExportTools } from '../pdf-export.ts'
import { verifyCommand } from '../verify/cli.ts'
import { expectations } from '../verify/expectations.ts'
import { PopplerMissingError } from '../verify/poppler.ts'
import type { PdfReader } from '../verify/reader.ts'
import { findingMissing, findingTools } from './fake-find.ts'

const missing = findingMissing
const POPPLER = { names: ['pdftotext', 'pdfinfo'], install: 'brew install poppler' }
const POPPLER_LINE =
  'poppler is required but pdftotext and pdfinfo could not be found; install with: brew install poppler'

const DIR = mkdtempSync(join(tmpdir(), 'entry-points-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
const SAMPLE_CV = fileURLToPath(new URL('../verify/testdata/sample-cv.json', import.meta.url))
const file = (name: string, text: string): string => {
  const path = join(DIR, name)
  writeFileSync(path, text)
  return path
}

let out: string[]
let err: string[]
beforeEach(() => {
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')))
})
afterEach(() => vi.restoreAllMocks())
const said = (lines: string[]): string => lines.join('\n')
const count = (text: string, needle: string): number => text.split(needle).length - 1

describe('the export command', () => {
  const EXPORT_USAGE = 'usage: node scripts/cv-pdf/export-pdf.ts --data <cv.json>'

  it('exits 64 with usage when --data is absent, without looking for tools', async () => {
    const { find, asked } = missing({ poppler: POPPLER })
    assert.equal(await exportPdfCommand([], find), 64)
    assert.match(said(err), new RegExp(EXPORT_USAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.deepEqual(asked, [])
  })

  it('exits 64 when a flag has no path', async () => {
    const { find } = missing({})
    assert.equal(await exportPdfCommand(['--data'], find), 64)
    assert.match(said(err), /ERROR: --data needs a path/)
    err.length = 0
    assert.equal(await exportPdfCommand(['--data', SAMPLE_CV, '--keywords'], find), 64)
    assert.match(said(err), /ERROR: --keywords needs a path/)
  })

  it('exits 64 for an unknown option', async () => {
    assert.equal(await exportPdfCommand(['--data', SAMPLE_CV, '--oops'], missing({}).find), 64)
  })

  it('exits 66 for missing poppler before it reads the CV, printing the install command once', async () => {
    const { find, asked } = missing({ poppler: POPPLER })
    const code = await exportPdfCommand(['--data', join(DIR, 'no-such.json')], find)
    assert.equal(code, 66)
    const text = said(err)
    assert.match(text, new RegExp(`ERROR: ${POPPLER_LINE}`))
    assert.equal(count(text, 'brew install poppler'), 1)
    assert.doesNotMatch(text, /could not read/)
    assert.deepEqual(asked, [undefined])
  })

  it('reports poppler and not Chrome when both are missing', async () => {
    const { find } = missing({ chrome: 'no Chrome here', poppler: POPPLER })
    assert.equal(await exportPdfCommand(['--data', SAMPLE_CV], find), 66)
    assert.match(said(err), /poppler is required but/)
    assert.doesNotMatch(said(err), /no Chrome here/)
  })

  it('exits 66 for missing Chrome, after the CV has been read, before any build', async () => {
    const { find } = missing({ chrome: 'install Chrome or set CHROME_PATH' })
    assert.equal(await exportPdfCommand(['--data', SAMPLE_CV, join(DIR, 'x.pdf')], find), 66)
    assert.equal(said(err), '\n  ERROR: install Chrome or set CHROME_PATH\n')
    assert.doesNotMatch(said(out), /building/)
  })

  it('reads the CV before it names Chrome: unreadable is 66, bad JSON and bad CV are 65', async () => {
    const { find } = missing({ chrome: 'no Chrome here' })
    assert.equal(await exportPdfCommand(['--data', join(DIR, 'no-such.json')], find), 66)
    assert.match(said(err), /could not read/)
    assert.equal(await exportPdfCommand(['--data', file('notjson.json', '{nope')], find), 65)
    assert.match(said(err), /is not valid JSON/)
    assert.equal(await exportPdfCommand(['--data', file('empty.json', '{}')], find), 65)
    assert.match(said(err), /is not a valid CV/)
    assert.doesNotMatch(said(err), /no Chrome here/)
  })

  // The entry line is the one thing the in-process tests cannot reach.
  it('starts from the command line and exits 64 with no --data', () => {
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../export-pdf.ts', import.meta.url))],
      { encoding: 'utf8', timeout: 60_000 },
    )
    assert.equal(r.status, 64, r.stdout + r.stderr)
    assert.match(r.stderr, /usage:/)
  })
})

describe('the verify command', () => {
  const SEED = fileURLToPath(new URL('../verify/testdata/seed-cv.json', import.meta.url))
  const PDF = join(DIR, 'never-read.pdf')

  it('asks for poppler only, after --data is read, and exits 66 naming the install once', async () => {
    const { find, asked } = missing({ poppler: POPPLER })
    assert.equal(await verifyCommand(['--data', SEED, PDF], find), 66)
    assert.deepEqual(asked, ['poppler'])
    assert.match(said(out), /^expectations from .*: \d+ keywords, \d+ job pairs$/)
    assert.equal(said(err), `\n  ERROR: ${POPPLER_LINE}\n`)
    assert.equal(count(said(err), 'brew install poppler'), 1)
  })

  it('reports a bad --data before it looks for poppler', async () => {
    const { find, asked } = missing({ poppler: POPPLER })
    assert.equal(await verifyCommand(['--data', join(DIR, 'no-such.json'), PDF], find), 66)
    assert.match(said(err), /could not read --data/)
    assert.equal(await verifyCommand(['--data', file('v-notjson.json', '{nope'), PDF], find), 65)
    assert.equal(await verifyCommand(['--data', file('v-array.json', '[]'), PDF], find), 65)
    assert.deepEqual(asked, [])
  })

  it('exits 64 for the usage errors, each with its own message', async () => {
    const { find } = missing({ poppler: POPPLER })
    assert.equal(await verifyCommand([PDF], find), 64)
    assert.match(said(err), /--data <cv.json> is required/)
    assert.equal(await verifyCommand([`--data=${SEED}`, PDF], find), 64)
    assert.match(said(err), /use --data <path>, not --data=<path>/)
    assert.equal(await verifyCommand([PDF, '--data'], find), 64)
    assert.match(said(err), /--data needs a path/)
    assert.equal(await verifyCommand(['--data', SEED, '--oops', PDF], find), 64)
    assert.match(said(err), /unknown option --oops/)
    err.length = 0
    assert.equal(await verifyCommand(['--data', SEED], find), 64)
    assert.match(said(err), /^usage: node verify\/cli.ts/)
  })
})

// Fakes that pass every check, so a run through the real command functions needs no tools.
const cv = CvDataSchema.parse(JSON.parse(readFileSync(SAMPLE_CV, 'utf8')))
const exp = expectations(cv)
const text = [
  ...exp.contact,
  ...exp.headings,
  ...exp.keywords,
  ...exp.pairs.map(([company, start]) => `${company} ${start}`),
  'Built and ran the analytical engine for a team of engineers and mathematicians. '.repeat(8),
].join('\n')
const reader = (over: Partial<PdfReader> = {}): PdfReader => ({
  info: async () => ({ pages: 1, size: 'A4', tagged: 'yes' }),
  pageText: async () => '',
  textInEveryEngine: async () =>
    ['poppler', 'pdfjs', 'mupdf'].map((name) => ({ name, text, streamOrder: false })),
  glyphSizes: async () => new Map([[10, 100]]),
  linkTargets: async () => [{ uri: 'mailto:ada@example.com' }],
  ...over,
})
const tools = (over: Partial<PdfReader> = {}, printed: string[] = []): ExportTools => ({
  printer: {
    async print(_cv, pdf) {
      printed.push(pdf)
      writeFileSync(pdf, 'x')
      return { fittedPages: 1, mounted: true }
    },
  },
  reader: reader(over),
})
const gone = new PopplerMissingError(['pdftotext'], 'brew install poppler')
const vanishing = { info: async () => Promise.reject(gone) }

describe('the commands on found tools', () => {
  it('exports and exits 0, writing the given path', async () => {
    const printed: string[] = []
    const pdf = join(DIR, 'given.pdf')
    const code = await exportPdfCommand(
      ['--data', SAMPLE_CV, pdf],
      findingTools(tools({}, printed)).find,
    )
    assert.equal(code, 0)
    assert.deepEqual(printed, [pdf])
    assert.match(said(out), /Done: /)
  })

  it('writes the default file name in the current directory when no path is given', async () => {
    const cwd = process.cwd()
    const work = join(DIR, 'cwd')
    mkdirSync(work)
    process.chdir(work)
    try {
      const code = await exportPdfCommand(['--data', SAMPLE_CV], findingTools(tools()).find)
      assert.equal(code, 0)
      assert.ok(existsSync(join(work, pdfFileName(cv.name))))
    } finally {
      process.chdir(cwd)
    }
  })

  it('reads --keywords into the expectations, so a keyword the PDF lacks fails the run', async () => {
    const pdf = join(DIR, 'kw.pdf')
    const ok = file('kw-ok.txt', `${exp.keywords[0]}\n\n`)
    assert.equal(
      await exportPdfCommand(
        ['--data', SAMPLE_CV, '--keywords', ok, pdf],
        findingTools(tools()).find,
      ),
      0,
    )
    const bad = file('kw-bad.txt', 'Zzyzx-not-in-the-pdf\n')
    assert.equal(
      await exportPdfCommand(
        ['--data', SAMPLE_CV, '--keywords', bad, pdf],
        findingTools(tools()).find,
      ),
      1,
    )
    assert.match(said(err), /failed verification/)
  })
})

describe('the commands when poppler vanishes or checks fail', () => {
  it('exits 66 with the message once when poppler vanishes during the export', async () => {
    const pdf = join(DIR, 'gone.pdf')
    const code = await exportPdfCommand(
      ['--data', SAMPLE_CV, pdf],
      findingTools(tools(vanishing)).find,
    )
    assert.equal(code, 66)
    assert.equal(count(said(err), gone.message), 1)
  })

  it('verify exits 0 when the checks pass and 1 when one fails', async () => {
    const pdf = file('v.pdf', 'x')
    assert.equal(await verifyCommand(['--data', SAMPLE_CV, pdf], findingTools(tools()).find), 0)
    const short = tools({ info: async () => ({ pages: 9, size: 'A4', tagged: 'yes' }) })
    assert.equal(await verifyCommand(['--data', SAMPLE_CV, pdf], findingTools(short).find), 1)
  })

  it('verify exits 66 with the message once when poppler vanishes during a read', async () => {
    const pdf = file('v2.pdf', 'x')
    const code = await verifyCommand(
      ['--data', SAMPLE_CV, pdf],
      findingTools(tools(vanishing)).find,
    )
    assert.equal(code, 66)
    assert.equal(count(said(err), gone.message), 1)
  })
})
