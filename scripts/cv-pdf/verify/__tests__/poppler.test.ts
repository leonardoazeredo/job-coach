import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  ensurePoppler,
  type FindResult,
  findPoppler,
  type PopplerDeps,
  PopplerMissingError,
  pdfInfo,
  pdfToText,
} from '../poppler.ts'

const FOUND = { pdftotext: '/x/pdftotext', pdfinfo: '/x/pdfinfo' }

// Injected deps that record every interaction; `finds` is consumed one per call.
function fake(
  over: Partial<PopplerDeps> & { finds: FindResult[]; answer?: boolean; exitCode?: number },
) {
  const calls = { asked: [] as string[], installed: [] as string[][], logs: [] as string[] }
  const finds = [...over.finds]
  const deps: PopplerDeps = {
    find: () => {
      const next = finds.shift()
      assert.ok(next, 'find called more often than expected')
      return next
    },
    isInteractive: over.isInteractive ?? true,
    ask: async (q) => {
      calls.asked.push(q)
      return over.answer ?? false
    },
    install: async (cmd) => {
      calls.installed.push(cmd)
      return over.exitCode ?? 0
    },
    platform: over.platform ?? 'darwin',
    log: (m) => calls.logs.push(m),
  }
  return { deps, calls }
}

describe('ensurePoppler', () => {
  it('resolves when both tools are found, without asking', async () => {
    const { deps, calls } = fake({ finds: [FOUND] })
    assert.equal(await ensurePoppler(deps), undefined)
    assert.deepEqual(calls.asked, [])
    assert.deepEqual(calls.installed, [])
  })

  it('installs with brew on an explicit yes, then finds again', async () => {
    const { deps, calls } = fake({
      finds: [{ missing: ['pdftotext', 'pdfinfo'] }, FOUND],
      answer: true,
    })
    await ensurePoppler(deps)
    assert.equal(calls.asked.length, 1)
    assert.match(calls.asked[0], /Homebrew.*\[y\/N\]/)
    assert.deepEqual(calls.installed, [['brew', 'install', 'poppler']])
  })

  it('throws PopplerMissingError on no, without installing', async () => {
    const { deps, calls } = fake({ finds: [{ missing: ['pdftotext', 'pdfinfo'] }], answer: false })
    await assert.rejects(ensurePoppler(deps), (e: unknown) => {
      assert.ok(e instanceof PopplerMissingError)
      assert.match(e.message, /pdftotext and pdfinfo could not be found/)
      assert.equal(e.message.split('brew install poppler').length - 1, 1)
      return true
    })
    assert.deepEqual(calls.installed, [])
  })

  it('throws without asking or logging when not interactive; the caller prints the hint once', async () => {
    const { deps, calls } = fake({
      finds: [{ missing: ['pdftotext', 'pdfinfo'] }],
      isInteractive: false,
    })
    await assert.rejects(ensurePoppler(deps), PopplerMissingError)
    assert.deepEqual(calls.asked, [])
    assert.deepEqual(calls.installed, [])
    assert.deepEqual(calls.logs, [])
    await assert.rejects(
      ensurePoppler(fake({ finds: [{ missing: ['pdfinfo'] }], isInteractive: false }).deps),
      (e: unknown) => {
        assert.ok(e instanceof PopplerMissingError)
        assert.equal(e.message.split('brew install poppler').length - 1, 1)
        return true
      },
    )
  })

  it('names only the missing tool when poppler is half installed', async () => {
    const { deps } = fake({ finds: [{ missing: ['pdfinfo'] }], isInteractive: false })
    await assert.rejects(ensurePoppler(deps), (e: unknown) => {
      assert.ok(e instanceof PopplerMissingError)
      assert.match(e.message, /pdfinfo/)
      assert.doesNotMatch(e.message, /pdftotext/)
      return true
    })
  })

  it('still fails when the install ran but the tools are still missing', async () => {
    const { deps } = fake({
      finds: [{ missing: ['pdfinfo'] }, { missing: ['pdfinfo'] }],
      answer: true,
    })
    await assert.rejects(ensurePoppler(deps), PopplerMissingError)
  })

  it('fails when brew exits non-zero', async () => {
    const { deps } = fake({ finds: [{ missing: ['pdfinfo'] }], answer: true, exitCode: 1 })
    await assert.rejects(ensurePoppler(deps), PopplerMissingError)
  })

  it('prints a package-manager hint off macOS and never installs', async () => {
    const { deps, calls } = fake({
      finds: [{ missing: ['pdftotext', 'pdfinfo'] }],
      platform: 'linux',
      answer: true,
    })
    await assert.rejects(ensurePoppler(deps), (e: unknown) => {
      assert.ok(e instanceof PopplerMissingError)
      assert.match(e.message, /apt|dnf/)
      return true
    })
    assert.deepEqual(calls.asked, [])
    assert.deepEqual(calls.installed, [])
    assert.deepEqual(calls.logs, [])
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
