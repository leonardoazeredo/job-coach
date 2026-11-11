import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { expectations } from '../expectations.ts'
import { PopplerMissingError } from '../poppler.ts'
import { realPdfReader } from '../reader.ts'
import { verifyEach, verifyPdf } from '../run.ts'
import { hasPoppler } from './hasPoppler.ts'

// The CLI under test is an engine entry point, so the paths come from this file's location and
// not the working directory.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CLI = join(ROOT, 'verify/cli.ts')
const SEED = join(ROOT, 'verify/testdata/seed-cv.json')
const SAMPLE = join(ROOT, 'verify/testdata/sample-cv.pdf')

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr }
}

const SEED_EXPECTATIONS = expectations(JSON.parse(readFileSync(SEED, 'utf8')))

function headerNumbers(output: string): number[] {
  return [...output.matchAll(/^ {2}\[(\d+)\] /gm)].map((m) => Number(m[1]))
}

// Outside the poppler-gated block: the usage error must hold on a machine without poppler too.
describe('verify cli without --data', () => {
  it('names --data, prints usage, exits 64 and checks no PDF', () => {
    const r = cli(SAMPLE)
    assert.equal(r.code, 64, r.all)
    assert.match(r.err, /--data/)
    assert.match(r.err, /usage:/)
    assert.doesNotMatch(r.all, /\[1\] |RESULT:|MISSING FILE/)
  })

  it('does not read a PDF that is absent', () => {
    const r = cli('/nonexistent/x.pdf')
    assert.equal(r.code, 64, r.all)
    assert.doesNotMatch(r.all, /MISSING FILE/)
  })
})

describe.skipIf(!hasPoppler)('verify cli', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-cli-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('prints usage and exits 64 with no files', () => {
    const r = cli('--data', SEED)
    assert.equal(r.code, 64)
    assert.match(r.err, /usage:/)
  })

  it('reports an unreadable --data file and exits 66', () => {
    const r = cli('--data', join(dir, 'nope.json'), SAMPLE)
    assert.equal(r.code, 66)
    assert.match(r.err, /could not read --data/)
  })

  it('requires --data to hold a JSON object', async () => {
    const file = join(dir, 'array.json')
    await writeFile(file, '[]')
    const r = cli('--data', file, SAMPLE)
    assert.equal(r.code, 65)
    assert.match(r.err, /should hold a JSON object/)
  })

  it('rejects invalid JSON in --data', async () => {
    const file = join(dir, 'bad.json')
    await writeFile(file, '{not json')
    const r = cli('--data', file, SAMPLE)
    assert.equal(r.code, 65)
    assert.match(r.err, /is not valid JSON/)
  })

  it('exits 65 with one line for a --data object of the wrong shape', async () => {
    const file = join(dir, 'shape.json')
    await writeFile(file, '{"skills":"React","work":{}}')
    const r = cli('--data', file, SAMPLE)
    assert.equal(r.code, 65)
    assert.match(r.err, /is not a CV/)
    assert.doesNotMatch(r.err, /\n\s+at /)
  })

  it('treats -- as the end of options', () => {
    const r = cli('--data', SEED, '--', join(dir, '--weird.pdf'))
    assert.equal(r.code, 1)
    assert.match(r.out, /--weird\.pdf/)
    assert.match(r.out, /MISSING FILE/)
  })

  it('treats option-like names after -- as files', () => {
    for (const name of ['--data', '--data=x.pdf']) {
      const r = cli('--data', SEED, '--', name)
      assert.equal(r.code, 1, r.all)
      assert.match(r.out, /MISSING FILE/)
    }
  })

  it('rejects --data=path', () => {
    const r = cli('--data=verify/testdata/seed-cv.json', SAMPLE)
    assert.equal(r.code, 64)
    assert.match(r.err, /use --data <path>, not --data=<path>/)
  })

  it('rejects --data with no path', () => {
    const r = cli(SAMPLE, '--data')
    assert.equal(r.code, 64)
    assert.match(r.err, /--data needs a path/)
  })

  it('reports a missing PDF and counts it as a failure', () => {
    const r = cli('--data', SEED, join(dir, 'absent.pdf'))
    assert.equal(r.code, 1)
    assert.match(r.out, /MISSING FILE/)
  })

  it('fails a zero-byte PDF without throwing', async () => {
    const file = join(dir, 'empty.pdf')
    await writeFile(file, '')
    const r = cli('--data', SEED, file)
    assert.equal(r.code, 1, r.all)
    assert.deepEqual(headerNumbers(r.out), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.match(r.out, /FAIL could not read the page count/)
    const first = r.out.split(/^ {2}\[2\] /m)[0]
    assert.match(first, /FAIL pdf\.js: extraction error: .*empty/)
    assert.doesNotMatch(first, /^ {6}ok {3}(poppler|pdf\.js|mupdf)/m)
    assert.match(r.out, /RESULT: \d+ failing check\(s\)/)
    assert.doesNotMatch(r.err, /at .*\.ts:\d+/)
  })

  it('sums failures over several files', () => {
    const r = cli('--data', SEED, join(dir, 'a.pdf'), join(dir, 'b.pdf'))
    assert.equal(r.code, 1)
    assert.equal(r.out.match(/MISSING FILE/g)?.length, 2)
  })

  it('runs all ten sections on a real PDF', () => {
    const r = cli('--data', SEED, SAMPLE)
    assert.deepEqual(headerNumbers(r.out), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.match(r.out, /RESULT: /)
    assert.match(r.out, /^expectations from .*cv\.json: \d+ keywords, \d+ job pairs$/m)
  })
})

describe('verifyPdf', () => {
  it.skipIf(!hasPoppler)(
    'logs ten sections and counts at least one failure per FAIL section',
    async () => {
      const lines: string[] = []
      const failures = await verifyPdf(SAMPLE, SEED_EXPECTATIONS, realPdfReader, (l) =>
        lines.push(l),
      )
      const text = lines.join('\n')
      assert.deepEqual(headerNumbers(text), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      // A section may add more than one failure (e.g. one per engine in [1]), never fewer.
      const bodies = text.split(/^ {2}\[\d+\] .*$/m).slice(1)
      assert.equal(bodies.length, 10)
      const failing = bodies.filter((b) => /^ {6}FAIL /m.test(b)).length
      assert.ok(failures >= failing, `${failures} failures for ${failing} FAIL sections`)
      assert.equal(failures === 0, failing === 0)
      assert.match(
        text,
        failures === 0 ? /RESULT: PASS/ : new RegExp(`RESULT: ${failures} failing check`),
      )
    },
  )

  it("reports an unexpected error as that file's failure and continues", async () => {
    const lines: string[] = []
    const verify = async (pdf: string): Promise<number> => {
      if (pdf === 'boom.pdf') throw new Error('kaput')
      return 0
    }
    const total = await verifyEach(['boom.pdf', 'fine.pdf'], SEED_EXPECTATIONS, realPdfReader, {
      log: (l) => lines.push(l),
      verify,
    })
    assert.equal(total, 1)
    assert.match(lines.join('\n'), /FAIL could not verify boom\.pdf: kaput/)
  })

  it('lets PopplerMissingError escape', async () => {
    const verify = async (): Promise<number> => {
      throw new PopplerMissingError(['pdftotext'], 'brew install poppler')
    }
    await assert.rejects(
      verifyEach(['a.pdf'], SEED_EXPECTATIONS, realPdfReader, {
        log: () => {
          // output is irrelevant: the error must escape before any report
        },
        verify,
      }),
      PopplerMissingError,
    )
  })

  it('returns 1 for a missing file without logging sections', async () => {
    const lines: string[] = []
    const failures = await verifyPdf('/nonexistent/x.pdf', SEED_EXPECTATIONS, realPdfReader, (l) =>
      lines.push(l),
    )
    assert.equal(failures, 1)
    assert.deepEqual(headerNumbers(lines.join('\n')), [])
  })
})
