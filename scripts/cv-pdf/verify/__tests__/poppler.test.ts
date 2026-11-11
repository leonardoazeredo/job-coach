import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { findPoppler, installHint, PopplerMissingError, pdfInfo, pdfToText } from '../poppler.ts'

describe('installHint', () => {
  it('names the package manager command for each platform', () => {
    assert.equal(installHint('darwin'), 'brew install poppler')
    assert.match(installHint('linux'), /apt install poppler-utils/)
    assert.match(installHint('win32'), /package manager/)
  })
})

describe('findPoppler', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'poppler-find-'))
    for (const sub of ['a', 'b', 'c']) await mkdir(join(dir, sub))
    await writeFile(join(dir, 'a', 'pdftotext'), '#!/bin/sh\n')
    await chmod(join(dir, 'a', 'pdftotext'), 0o755)
    await writeFile(join(dir, 'b', 'pdfinfo'), '#!/bin/sh\n')
    await chmod(join(dir, 'b', 'pdfinfo'), 0o755)
    // Present but not executable: must not count.
    await writeFile(join(dir, 'c', 'pdfinfo'), '')
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('finds each tool across PATH entries', () => {
    const r = findPoppler([join(dir, 'a'), join(dir, 'b')].join(delimiter))
    assert.deepEqual(r, {
      pdftotext: join(dir, 'a', 'pdftotext'),
      pdfinfo: join(dir, 'b', 'pdfinfo'),
    })
  })

  it('reports exactly the missing tool', () => {
    assert.deepEqual(findPoppler(join(dir, 'a')), { missing: ['pdfinfo'] })
    assert.deepEqual(findPoppler(join(dir, 'c')), { missing: ['pdftotext', 'pdfinfo'] })
    assert.deepEqual(findPoppler(''), { missing: ['pdftotext', 'pdfinfo'] })
  })
})

describe('poppler wrappers', () => {
  let dir: string
  let awkward: string
  beforeAll(async () => {
    // Directory and file names with spaces and a leading "-" must reach poppler
    // as one argv entry with no shell splitting them.
    dir = await mkdtemp(join(tmpdir(), 'poppler-args-'))
    await mkdir(join(dir, '-x dir'))
    awkward = join(dir, '-x dir', '-cv y.pdf')
    await copyFile(fileURLToPath(new URL('../testdata/sample-cv.pdf', import.meta.url)), awkward)
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('reads pages, size and tagging', async () => {
    assert.deepEqual(await pdfInfo(awkward), {
      pages: 2,
      size: '594.96 x 841.92 pts (A4)',
      tagged: 'yes',
    })
  })

  it('extracts text and passes extra flags', async () => {
    assert.match(await pdfToText(awkward), /^Sam Sample/)
    const page2 = await pdfToText(awkward, ['-f', '2', '-l', '2'])
    assert.ok(page2.trim().length > 0)
    assert.ok(!page2.includes('SUMMARY'), 'page 1 heading leaked into a page 2 extraction')
  })

  it('reports a vanished poppler as PopplerMissingError', async () => {
    const saved = process.env.PATH
    process.env.PATH = ''
    try {
      await assert.rejects(pdfInfo(awkward), PopplerMissingError)
      await assert.rejects(pdfToText(awkward), PopplerMissingError)
    } finally {
      process.env.PATH = saved
    }
  })

  it('rejects on a file that is not a PDF', async () => {
    const bad = join(dir, 'not-a-pdf.pdf')
    await writeFile(bad, 'hello\n')
    await assert.rejects(pdfToText(bad))
    await assert.rejects(pdfInfo(bad))
  })
})
