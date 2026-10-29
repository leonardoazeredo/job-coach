import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { FALLBACK_EXPECTATIONS } from '../fallback.ts'
import { installHint, PopplerMissingError } from '../poppler.ts'
import { verifyEach, verifyPdf } from '../run.ts'
import { hasPoppler } from './hasPoppler.ts'

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

function headerNumbers(output: string): number[] {
  return [...output.matchAll(/^ {2}\[(\d+)\] /gm)].map((m) => Number(m[1]))
}

describe.skipIf(!hasPoppler)('verify cli', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-cli-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('prints usage and exits 64 with no files', () => {
    const r = cli()
    assert.equal(r.code, 64)
    assert.match(r.err, /usage:/)
  })

  it('reports an unreadable --data file', () => {
    const r = cli('--data', join(dir, 'nope.json'), SAMPLE)
    assert.notEqual(r.code, 0)
    assert.match(r.err, /could not read --data/)
  })

  it('requires --data to hold a JSON object', async () => {
    const file = join(dir, 'array.json')
    await writeFile(file, '[]')
    const r = cli('--data', file, SAMPLE)
    assert.notEqual(r.code, 0)
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
      const r = cli('--', name)
      assert.equal(r.code, 1, r.all)
      assert.match(r.out, /MISSING FILE/)
    }
  })

  it('rejects --data=path', () => {
    const r = cli('--data=verify/testdata/seed-cv.json', SAMPLE)
    assert.notEqual(r.code, 0)
    assert.match(r.err, /use --data <path>, not --data=<path>/)
  })

  it('rejects --data with no path', () => {
    const r = cli(SAMPLE, '--data')
    assert.notEqual(r.code, 0)
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

// PATH="" hides pdftotext/pdfinfo; the absolute execPath still runs. stdout is
// piped, so the run is non-interactive and never prompts to install.
function withoutPoppler(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, PATH: '' },
  })
  return { code: r.status, all: r.stdout + r.stderr }
}

describe('a missing poppler', () => {
  const hint = new RegExp(installHint(process.platform).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')

  it('exits 2 from the CLI and prints the install hint once', () => {
    const r = withoutPoppler(CLI, '--data', SEED, SAMPLE)
    assert.equal(r.code, 2, r.all)
    assert.equal(r.all.match(hint)?.length, 1, r.all)
  })

  // Goes through main's catch, which a PopplerMissingError thrown later in the
  // run (from verifyPdf's own ensurePoppler) takes as well.
  it('exits 2 from the export before building and prints the hint once', () => {
    const r = withoutPoppler(
      join(ROOT, 'export-pdf.ts'),
      '--data',
      SEED,
      join(tmpdir(), 'never-written.pdf'),
    )
    assert.equal(r.code, 2, r.all)
    assert.equal(r.all.match(hint)?.length, 1, r.all)
    assert.doesNotMatch(r.all, /building/)
  })
})

describe('verifyPdf', () => {
  it.skipIf(!hasPoppler)(
    'logs ten sections and counts at least one failure per FAIL section',
    async () => {
      const lines: string[] = []
      const failures = await verifyPdf(SAMPLE, FALLBACK_EXPECTATIONS, (l) => lines.push(l))
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
    const total = await verifyEach(
      ['boom.pdf', 'fine.pdf'],
      FALLBACK_EXPECTATIONS,
      (l) => lines.push(l),
      verify,
    )
    assert.equal(total, 1)
    assert.match(lines.join('\n'), /FAIL could not verify boom\.pdf: kaput/)
  })

  it('lets PopplerMissingError escape', async () => {
    const verify = async (): Promise<number> => {
      throw new PopplerMissingError(['pdftotext'], 'brew install poppler')
    }
    await assert.rejects(
      verifyEach(['a.pdf'], FALLBACK_EXPECTATIONS, () => {}, verify),
      PopplerMissingError,
    )
  })

  it('returns 1 for a missing file without logging sections', async () => {
    const lines: string[] = []
    const failures = await verifyPdf('/nonexistent/x.pdf', FALLBACK_EXPECTATIONS, (l) =>
      lines.push(l),
    )
    assert.equal(failures, 1)
    assert.deepEqual(headerNumbers(lines.join('\n')), [])
  })
})
