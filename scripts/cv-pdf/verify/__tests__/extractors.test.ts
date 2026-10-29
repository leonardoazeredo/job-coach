import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js'
import { afterAll, beforeAll, describe, it } from 'vitest'
import type { MupdfPageSource } from '../extractors.ts'
import { extractAll, joinPdfjsItems, mupdfPagesText, mupdfText, pdfjsText } from '../extractors.ts'
import { glyphSizes, linkTargets } from '../glyphs.ts'
import { runInWorker } from '../runInWorker.ts'

const CV = fileURLToPath(new URL('../testdata/sample-cv.pdf', import.meta.url))
const ENGINES = ['poppler', 'poppler -layout', 'poppler -raw', 'pdf.js', 'mupdf']
// Every failure path must settle well inside this; a hang fails the test.
const NO_HANG = { timeout: 30_000 }

const FI = '\uFB01'
const NBSP = '\u00A0'
const SHY = '\u00AD'

/**
 * One page, non-embedded Helvetica whose ToUnicode maps code 01 to U+FB01, 02
 * to U+00A0 and 03 to U+00AD: "of<fi>ce A<nbsp>B soft<shy>ware" on one line,
 * and on the next "con<fi>g" with the ligature wrapped in /ActualText (fi), as
 * testdata/bad/ligatures.pdf, a Chrome print, marks its ligatures.
 */
function specialCharsPdf(): Uint8Array {
  return helveticaPdf([
    'BT /F1 12 Tf 72 720 Td (of\\001ce A\\002B soft\\003ware) Tj ET',
    'BT /F1 12 Tf 72 700 Td (con) Tj /Span << /ActualText (fi) >> BDC (\\001) Tj EMC (g) Tj ET',
  ])
}

/**
 * Two separately positioned runs on one baseline at 12pt. "ab" is 13.344pt wide
 * in Helvetica, so "cd" at x=85.344 touches it and at x=88.344 sits 0.25em away.
 */
function adjacentRunsPdf(): Uint8Array {
  return helveticaPdf([
    'BT /F1 12 Tf 72 720 Td (ab) Tj ET BT /F1 12 Tf 85.344 720 Td (cd) Tj ET',
    'BT /F1 12 Tf 72 700 Td (ab) Tj ET BT /F1 12 Tf 88.344 700 Td (cd) Tj ET',
  ])
}

function helveticaPdf(lines: string[]): Uint8Array {
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '1 beginbfrange <20> <7E> <0020> endbfrange',
    '3 beginbfchar <01> <FB01> <02> <00A0> <03> <00AD> endbfchar',
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n')
  const content = lines.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

/** One page whose annotations are the given dictionaries, each an object of its own. */
function annotationsPdf(annots: string[]): Uint8Array {
  const first = 6
  const refs = annots.map((_, i) => `${first + i} 0 R`).join(' ')
  const content = 'BT /F1 12 Tf 72 720 Td (links) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [${refs}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...annots.map((a) => `<< /Type /Annot /Subtype /Link /Rect [72 700 120 730] ${a} >>`),
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

let dir: string
const file = (name: string) => join(dir, name)
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'extractors-'))
  const special = specialCharsPdf()
  await writeFile(file('special.pdf'), special)
  await writeFile(file('adjacent.pdf'), adjacentRunsPdf())
  await writeFile(
    file('links.pdf'),
    annotationsPdf([
      '/A << /S /URI /URI (https://ok.example) >>',
      '/A << /S /Launch /F (calc.exe) >>',
      '/A << /S /JavaScript /JS (app.launchURL\\("https://js.example"\\)) >>',
      '/Dest [3 0 R /Fit]',
    ]),
  )
  await writeFile(file('empty.pdf'), '')
  await writeFile(file('text.pdf'), 'This is a plain text file, not a PDF.\n')
  const doc = new mupdf.PDFDocument(special)
  await writeFile(
    file('encrypted.pdf'),
    doc.saveToBuffer('encrypt=aes-256,user-password=secret,owner-password=owner').asUint8Array(),
  )
  doc.destroy()
})
afterAll(() => rm(dir, { recursive: true, force: true }))

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
function run(str: string, x: number, width: number, y = 700, hasEOL = false): TextItem {
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
        run('one', 0, 20, 700, true),
        run('two', 0, 20, 686),
        run('three', 0, 30, 672),
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
