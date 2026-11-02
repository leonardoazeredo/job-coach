import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { extractAll, mupdfText, pdfjsText } from '../extractors.ts'
import { glyphSizes } from '../glyphs.ts'
import { runInWorker } from '../runInWorker.ts'
import { ENGINES, NO_HANG, registerFixtures } from './extractorsFixtures.ts'

const file = registerFixtures()

describe('broken input fails loudly and promptly', () => {
  for (const name of ['empty.pdf', 'text.pdf', 'encrypted.pdf']) {
    it(`pdf.js rejects ${name}`, NO_HANG, async () => {
      await assert.rejects(pdfjsText(file(name)))
    })
    it(`MuPDF rejects ${name}`, NO_HANG, async () => {
      await assert.rejects(mupdfText(file(name)))
    })
    it(`extractAll reports every engine as an error for ${name}`, NO_HANG, async () => {
      const texts = await extractAll(file(name))
      assert.deepEqual(
        texts.map((e) => e.name),
        ENGINES,
      )
      for (const e of texts) {
        assert.match(e.text, /^<error /, `${e.name}: ${JSON.stringify(e.text.slice(0, 80))}`)
        assert.equal(e.streamOrder, false)
      }
    })
    it(`glyph sizes reject ${name}`, NO_HANG, async () => {
      await assert.rejects(glyphSizes(file(name)))
    })
  }
  it('a missing file is an error, not a crash', NO_HANG, async () => {
    const texts = await extractAll(file('absent.pdf'))
    assert.equal(texts.length, ENGINES.length)
    for (const e of texts) assert.match(e.text, /^<error /)
  })
})

describe('runInWorker', () => {
  const stub = (name: string) => new URL(`../testdata/workers/${name}.ts`, import.meta.url)

  it('terminates a worker that never replies and reports the timeout', NO_HANG, async () => {
    const started = Date.now()
    await assert.rejects(
      runInWorker('pdfjsText', 'x.pdf', { timeoutMs: 200, workerUrl: stub('hang') }),
      /pdfjsText timed out after 0\.2s/,
    )
    assert.ok(Date.now() - started < 5_000)
  })
  it('turns an uncaught throw in the worker into a rejection', NO_HANG, async () => {
    await assert.rejects(
      runInWorker('mupdfText', 'x.pdf', { workerUrl: stub('crash') }),
      /worker crashed: boom/,
    )
  })
  it('turns a worker that exits without a result into a rejection', NO_HANG, async () => {
    await assert.rejects(
      runInWorker('glyphSizes', 'x.pdf', { workerUrl: stub('exit') }),
      /exited with code 3/,
    )
  })
  it('keeps the error name of a failure inside the real worker', NO_HANG, async () => {
    await assert.rejects(runInWorker('pdfjsText', file('empty.pdf')), (e: unknown) => {
      assert.ok(e instanceof Error)
      assert.equal(e.name, 'InvalidPDFException')
      return true
    })
  })
})
