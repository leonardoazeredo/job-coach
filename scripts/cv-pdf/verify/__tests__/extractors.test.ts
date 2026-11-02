import assert from 'node:assert/strict'
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js'
import { describe, it } from 'vitest'
import { joinPdfjsItems, mupdfText, pdfjsText } from '../extractors.ts'
import { FI, NBSP, NO_HANG, registerFixtures, SHY } from './extractorsFixtures.ts'

const file = registerFixtures()

describe('raw characters survive', () => {
  it('pdf.js keeps the fi ligature, also under ActualText', NO_HANG, async () => {
    const text = await pdfjsText(file('special.pdf'))
    assert.ok(text.includes(`of${FI}ce`), JSON.stringify(text))
    assert.ok(text.includes(`con${FI}g`), JSON.stringify(text))
  })

  // pdf.js 6.3 folds U+00A0 to a space and drops U+00AD (an invisible format
  // mark) inside getTextContent with no option to keep them. Pinned so an
  // upgrade that changes this is noticed. MuPDF sees both here because this
  // fixture's ToUnicode maps a glyph to U+00AD; it does not see the soft hyphen
  // Chrome writes under ActualText (verify/testdata/README.md).
  it('pdf.js folds nbsp and drops the soft hyphen (known limitation)', NO_HANG, async () => {
    const text = await pdfjsText(file('special.pdf'))
    assert.ok(text.includes('A B'), JSON.stringify(text))
    assert.ok(text.includes('software'), JSON.stringify(text))
  })

  it(
    'MuPDF keeps the ligature (also under ActualText), nbsp and soft hyphen',
    NO_HANG,
    async () => {
      const text = await mupdfText(file('special.pdf'))
      assert.ok(text.includes(`of${FI}ce`), JSON.stringify(text))
      assert.ok(text.includes(`con${FI}g`), JSON.stringify(text))
      assert.ok(text.includes(`A${NBSP}B`), JSON.stringify(text))
      assert.ok(text.includes(`soft${SHY}ware`), JSON.stringify(text))
    },
  )
})

// A 12pt run on baseline y; width is the advance pdf.js would report.
function run(
  str: string,
  x: number,
  width: number,
  { y = 700, hasEOL = false }: { y?: number; hasEOL?: boolean } = {},
): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [12, 0, 0, 12, x, y],
    width,
    height: 12,
    fontName: 'F1',
    hasEOL,
  }
}

describe('joinPdfjsItems', () => {
  it('joins runs that touch, as at a ligature', () => {
    assert.equal(joinPdfjsItems([run('of', 0, 10), run(FI, 10, 6), run('ce', 16, 10)]), `of${FI}ce`)
  })
  it('does not insert a space for a gap of 0.1em', () => {
    assert.equal(joinPdfjsItems([run('ab', 0, 10), run('cd', 11.2, 10)]), 'abcd')
  })
  it('inserts a space for a gap of 0.2em', () => {
    assert.equal(joinPdfjsItems([run('ab', 0, 10), run('cd', 12.4, 10)]), 'ab cd')
  })
  it('does not double a space the PDF already has', () => {
    assert.equal(joinPdfjsItems([run('ab ', 0, 13), run('cd', 17, 10)]), 'ab cd')
  })
  it('treats a run starting over 1em before the previous end as a boundary', () => {
    assert.equal(joinPdfjsItems([run('abcdef', 0, 40), run('x', 20, 6)]), 'abcdef x')
  })
  it('breaks the line on hasEOL and on a baseline shift without it', () => {
    assert.equal(
      joinPdfjsItems([
        run('one', 0, 20, { y: 700, hasEOL: true }),
        run('two', 0, 20, { y: 686 }),
        run('three', 0, 30, { y: 672 }),
      ]),
      'one\ntwo\nthree',
    )
  })
})

describe('pdf.js join on separately written runs', () => {
  it('keeps touching runs together and separates a 0.25em gap', NO_HANG, async () => {
    const text = await pdfjsText(file('adjacent.pdf'))
    assert.ok(text.includes('abcd\n'), JSON.stringify(text))
    assert.ok(text.includes('ab cd\n'), JSON.stringify(text))
  })
})
