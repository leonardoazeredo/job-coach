// The suite's temp directory is a private folder that must be empty when the suite ends. Every test
// file's mkdtemp lands in it, so a test that forgets to clean up fails the run by name; and the
// run cannot be mistaken for another project's or another checkout's leftovers, as a count of the
// shared temp directory would be.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const leftovers = (root: string): string[] => readdirSync(root).sort()

export default function setup() {
  const realTmp = tmpdir()
  const root = mkdtempSync(join(realTmp, 'vitest-suite-'))
  const oldTmpdir = process.env.TMPDIR
  // os.tmpdir() reads TMPDIR on every call, and the test workers inherit it.
  process.env.TMPDIR = root
  return () => {
    if (oldTmpdir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = oldTmpdir
    const left = leftovers(root)
    rmSync(root, { recursive: true, force: true })
    if (left.length > 0)
      throw new Error(`tests left folders in the temp directory: ${left.join(', ')}`)
  }
}
