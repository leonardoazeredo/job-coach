import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { PopplerMissingError } from '../poppler.ts'
import type { PdfReader } from '../reader.ts'
import { verifyPdf } from '../run.ts'
import type { Expectations } from '../types.ts'

// The run only stats the file itself; every read of its content goes to the fake reader.
const EXISTING_FILE = fileURLToPath(import.meta.url)

const EXP: Expectations = {
  email: 'ada@example.com',
  keywords: ['TypeScript'],
  headings: ['EXPERIENCE'],
  contact: ['ada@example.com'],
  pairs: [],
}

const PROSE =
  'Built and ran the analytical engine for a team of engineers and mathematicians. '.repeat(8)
const CLEAN_TEXT = `Ada Lovelace\nada@example.com\nExperience\nTypeScript\n${PROSE}\n`

function reader(overrides: Partial<PdfReader> = {}): PdfReader {
  return {
    info: async () => ({ pages: 1, size: '595 x 842 pts (A4)', tagged: 'yes' }),
    pageText: async () => '',
    textInEveryEngine: async () => [
      { name: 'poppler', text: CLEAN_TEXT, streamOrder: false },
      { name: 'pdfjs', text: CLEAN_TEXT, streamOrder: false },
      { name: 'mupdf', text: CLEAN_TEXT, streamOrder: false },
    ],
    glyphSizes: async () => new Map([[10, 100]]),
    linkTargets: async () => [{ uri: 'mailto:ada@example.com' }],
    ...overrides,
  }
}

async function run(r: PdfReader, pdf = EXISTING_FILE) {
  const lines: string[] = []
  const failures = await verifyPdf(pdf, EXP, r, (l) => lines.push(l))
  return { failures, text: lines.join('\n') }
}

describe('verifyPdf on a fake reader', () => {
  it('passes a clean PDF', async () => {
    const { failures, text } = await run(reader())
    assert.equal(failures, 0, text)
    assert.match(text, /pages=1 {2}size=595 x 842 pts \(A4\) {2}tagged=yes/)
    assert.match(text, /RESULT: PASS/)
  })

  it('counts a failed check', async () => {
    const bad = `Ada Lovelace\nada@example.com\nExperience\n${PROSE}\n`
    const { failures, text } = await run(
      reader({
        textInEveryEngine: async () => [{ name: 'poppler', text: bad, streamOrder: false }],
      }),
    )
    assert.ok(failures >= 1, text)
    assert.match(text, /^ {6}FAIL /m)
    assert.match(text, new RegExp(`RESULT: ${failures} failing check`))
  })

  it('logs the ten sections in order and ends with the failure count', async () => {
    const { failures, text } = await run(
      reader({
        textInEveryEngine: async () => [{ name: 'poppler', text: '', streamOrder: false }],
      }),
    )
    const numbers = [...text.matchAll(/^ {2}\[(\d+)\] /gm)].map((m) => Number(m[1]))
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const fails = (text.match(/^ {6}FAIL /gm) ?? []).length
    assert.ok(failures >= 1 && failures >= fails, text)
    assert.match(text, new RegExp(`RESULT: ${failures} failing check`))
  })

  it('counts a missing file as one failure and reads nothing', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('should not read')
    }
    const { failures, text } = await run(
      reader({ info: boom, textInEveryEngine: boom }),
      '/nonexistent/x.pdf',
    )
    assert.equal(failures, 1)
    assert.match(text, /MISSING FILE/)
    assert.doesNotMatch(text, /\[1\] /)
  })

  it('fails the page balance check when the page count cannot be read', async () => {
    const { failures, text } = await run(
      reader({
        info: async () => {
          throw new Error('pdfinfo failed: bad file')
        },
      }),
    )
    assert.ok(failures >= 1, text)
    assert.match(text, /FAIL could not read the page count: pdfinfo failed: bad file/)
    assert.match(text, /pages=\? {2}size=\? {2}tagged=\?/)
  })

  it('lets PopplerMissingError from a read escape', async () => {
    await assert.rejects(
      run(
        reader({
          info: async () => {
            throw new PopplerMissingError(['pdfinfo'], 'brew install poppler')
          },
        }),
      ),
      PopplerMissingError,
    )
  })
})
