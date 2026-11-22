import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import setup, { leftovers } from './tmp-guard.global.ts'

describe('the temp directory guard', () => {
  // Dropping globalSetup from vitest.config.ts would leave every other test guarded by nothing.
  it('is wired in: the temp directory of a test is a vitest-suite folder', () => {
    expect(basename(tmpdir())).toMatch(/^vitest-suite-/)
  })

  it('fails on a folder a test left behind, says which one, and still removes its own root', () => {
    const outer = process.env.TMPDIR
    const teardown = setup()
    const root = tmpdir()
    mkdtempSync(join(root, 'leaked-'))
    expect(leftovers(root)).toHaveLength(1)
    expect(teardown).toThrow(/tests left folders in the temp directory: leaked-/)
    expect(existsSync(root)).toBe(false)
    expect(process.env.TMPDIR).toBe(outer)
  })

  it('passes when the folders it handed out were removed', () => {
    const teardown = setup()
    const root = tmpdir()
    rmSync(mkdtempSync(join(root, 'cleaned-')), { recursive: true })
    expect(teardown).not.toThrow()
    expect(existsSync(root)).toBe(false)
  })
})
