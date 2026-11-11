import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, it, vi } from 'vitest'
import { exportPdfCommand } from '../export-pdf.ts'
import { verifyCommand } from '../verify/cli.ts'
import { findingMissing } from './fake-find.ts'

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
