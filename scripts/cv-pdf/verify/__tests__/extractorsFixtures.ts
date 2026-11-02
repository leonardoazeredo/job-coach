import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import { afterAll, beforeAll } from 'vitest'

export const CV = fileURLToPath(new URL('../testdata/sample-cv.pdf', import.meta.url))
export const ENGINES = ['poppler', 'poppler -layout', 'poppler -raw', 'pdf.js', 'mupdf']
// Every failure path must settle well inside this; a hang fails the test.
export const NO_HANG = { timeout: 30_000 }

export const FI = '\uFB01'
export const NBSP = '\u00A0'
export const SHY = '\u00AD'

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

// Registers the fixture files for the calling test file; returns a path resolver.
export function registerFixtures(): (name: string) => string {
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
  return file
}
