import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, it, vi } from 'vitest'
import { findTools } from '../tools.ts'
import { installHint } from '../verify/poppler.ts'
import { realPdfReader } from '../verify/reader.ts'

// The lookup reads the process environment, so these stub it rather than the finders: that way
// the tests need neither Chrome nor poppler and cannot be fooled by one being installed.
const DIR = mkdtempSync(join(tmpdir(), 'find-tools-'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
afterEach(() => vi.unstubAllEnvs())

const EMPTY_PATH = join(DIR, 'empty')
const POPPLER_PATH = join(DIR, 'poppler-bin')
const NO_CHROME = join(DIR, 'no-chrome')
const CHROME = join(DIR, 'chrome')
mkdirSync(EMPTY_PATH)
mkdirSync(POPPLER_PATH)
for (const tool of ['pdftotext', 'pdfinfo']) {
  const file = join(POPPLER_PATH, tool)
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
}
writeFileSync(CHROME, '')

const env = (chrome: string, path: string): void => {
  vi.stubEnv('CHROME_PATH', chrome)
  vi.stubEnv('PATH', path)
}
const POPPLER = { names: ['pdftotext', 'pdfinfo'], install: installHint(process.platform) }
const CHROME_MESSAGE = `CHROME_PATH=${NO_CHROME} does not exist; point CHROME_PATH at a Chrome executable`

describe('findTools', () => {
  it('reports Chrome and poppler apart when both are missing', () => {
    env(NO_CHROME, EMPTY_PATH)
    assert.deepEqual(findTools(), { missing: { chrome: CHROME_MESSAGE, poppler: POPPLER } })
  })

  it('reports only poppler when Chrome is found', () => {
    env(CHROME, EMPTY_PATH)
    assert.deepEqual(findTools(), { missing: { poppler: POPPLER } })
  })

  it('reports only Chrome when poppler is found', () => {
    env(NO_CHROME, POPPLER_PATH)
    assert.deepEqual(findTools(), { missing: { chrome: CHROME_MESSAGE } })
  })

  it('returns the tools when both are found', () => {
    env(CHROME, POPPLER_PATH)
    const found = findTools()
    assert.ok('tools' in found)
    assert.equal(found.tools.reader, realPdfReader)
    assert.equal(typeof found.tools.printer.print, 'function')
  })

  it('looks only for poppler when asked, whatever CHROME_PATH says', () => {
    env(NO_CHROME, POPPLER_PATH)
    assert.deepEqual(findTools('poppler'), { reader: realPdfReader })
    env(NO_CHROME, EMPTY_PATH)
    assert.deepEqual(findTools('poppler'), { missing: { poppler: POPPLER } })
  })
})
