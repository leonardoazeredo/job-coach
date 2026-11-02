import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { MupdfPageSource } from '../extractors.ts'
import { extractAll, mupdfPagesText, mupdfText, pdfjsText } from '../extractors.ts'
import { glyphSizes, linkTargets } from '../glyphs.ts'
import { CV, ENGINES, NO_HANG, registerFixtures } from './extractorsFixtures.ts'

const file = registerFixtures()

describe('../testdata/sample-cv.pdf', () => {
  it('yields the five engines in order, all with text', NO_HANG, async () => {
    const texts = await extractAll(CV)
    assert.deepEqual(
      texts.map((e) => e.name),
      ENGINES,
    )
    assert.deepEqual(
      texts.map((e) => e.streamOrder),
      [false, false, true, false, false],
    )
    for (const e of texts) {
      assert.ok(e.text.trim().length > 1000, `${e.name} is nearly empty`)
      assert.doesNotMatch(e.text, /^<error/, e.name)
    }
  })

  it('pdf.js and MuPDF reproduce the visible word gaps', NO_HANG, async () => {
    for (const text of [await pdfjsText(CV), await mupdfText(CV)]) {
      // Separately written runs on one line, joined by the gap rule.
      assert.ok(
        text.includes('Harbour Travel, York, United Kingdom | June 2022 - Present (Hybrid)'),
        text.slice(0, 300),
      )
      assert.ok(text.includes('Technologies: Vue, Nuxt, TypeScript, Pinia, Vitest'))
      assert.doesNotMatch(text, /[^\s] {2,}[^\s]/, 'doubled spaces')
    }
  })

  it('puts line ends where the page breaks lines', NO_HANG, async () => {
    const text = await pdfjsText(CV)
    assert.ok(text.includes('Lead Frontend Engineer\nYork, United Kingdom'))
  })

  it('measures glyph sizes from 11.4 to 20.5pt', NO_HANG, async () => {
    const sizes = await glyphSizes(CV)
    const body = [...sizes].sort((a, b) => b[1] - a[1])[0][0]
    assert.equal(body, 11.4)
    assert.ok(sizes.has(12.4) && sizes.has(13))
    assert.equal(Math.min(...sizes.keys()), 11.4)
    assert.equal(Math.max(...sizes.keys()), 20.5)
  })

  it('reads the link targets', NO_HANG, async () => {
    assert.deepEqual(await linkTargets(CV), [
      { uri: 'https://linkedin.com/in/sam-sample' },
      { uri: 'https://github.com/sam-sample' },
    ])
  })
})

describe('link targets', () => {
  it('keeps only /URI actions as targets and names every other action', NO_HANG, async () => {
    assert.deepEqual(await linkTargets(file('links.pdf')), [
      { uri: 'https://ok.example' },
      { action: 'Launch' },
      { action: 'JavaScript' },
      { jump: true },
    ])
  })
})

describe('mupdfPagesText releases native handles', () => {
  function source(failOn: 'none' | 'stext' | 'asText') {
    const destroyed: string[] = []
    const doc: MupdfPageSource = {
      countPages: () => 2,
      loadPage: (n) => ({
        toStructuredText: () => {
          if (failOn === 'stext') throw new Error('parser failed')
          return {
            asText: () => {
              if (failOn === 'asText') throw new Error('text failed')
              return `p${n}`
            },
            destroy: () => destroyed.push(`stext${n}`),
          }
        },
        destroy: () => destroyed.push(`page${n}`),
      }),
    }
    return { doc, destroyed }
  }

  it('joins pages with a form feed and destroys each handle', () => {
    const { doc, destroyed } = source('none')
    assert.equal(mupdfPagesText(doc), 'p0\fp1\f')
    assert.deepEqual(destroyed, ['stext0', 'page0', 'stext1', 'page1'])
  })
  it('destroys the page when toStructuredText throws', () => {
    const { doc, destroyed } = source('stext')
    assert.throws(() => mupdfPagesText(doc), /parser failed/)
    assert.deepEqual(destroyed, ['page0'])
  })
  it('destroys the structured text and the page when reading it throws', () => {
    const { doc, destroyed } = source('asText')
    assert.throws(() => mupdfPagesText(doc), /text failed/)
    assert.deepEqual(destroyed, ['stext0', 'page0'])
  })
})
