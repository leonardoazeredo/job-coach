import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api.js'
import { PopplerMissingError, pdfToText } from './poppler.ts'
import { runInWorker } from './runInWorker.ts'
import type { EngineText } from './types.ts'

// Font programs for the 14 standard fonts, which a PDF may use without embedding.
const STANDARD_FONTS = fileURLToPath(
  new URL('../../standard_fonts/', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
)

/**
 * Opens with pdf.js and always releases the document, so a failed read cannot
 * leave a handle that keeps the process (or a test) alive.
 */
export async function withPdfjs<T>(
  pdf: string,
  use: (doc: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  // pdf.js transfers the buffer it is given, so every open reads its own copy.
  const data = new Uint8Array(await readFile(pdf))
  const task = getDocument({ data, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 })
  try {
    return await use(await task.promise)
  } finally {
    await task.destroy()
  }
}

/**
 * Text items of one page with characters as the PDF maps them: without
 * `disableNormalization`, pdf.js rewrites U+FB01 as "fi" and check [1]
 * (ligature glyphs) could never see a ligature. pdf.js 6.3 still folds U+00A0 to
 * a space and drops U+00AD, with no option to keep them. On Chrome's output,
 * MuPDF sees the nbsp (preserve-whitespace) but not the soft hyphen: Chrome
 * writes U+00AD as a space glyph tagged `/ActualText <FEFF00AD>`, and the
 * ignore-actualtext option that check [1] needs makes MuPDF report the space.
 * Only poppler flags Chrome's soft hyphen for check [2].
 */
export async function pdfjsItems(doc: PDFDocumentProxy, pageNumber: number): Promise<TextItem[]> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent({ disableNormalization: true })
  return content.items.filter((i: TextItem | TextMarkedContent): i is TextItem => 'str' in i)
}

// A run that starts more than this far (in ems) past the end of the previous one
// on the same baseline is a separate word. In the sample CV the word spaces
// are explicit " " runs and the positional gaps are 0 or slightly negative, so the
// rule matters only for PDFs that position words without a space run. Runs that
// touch with no whitespace between them are ligature joins at 0.00em, as around
// each U+FB01/U+FB02 glyph in testdata/bad/ligatures.pdf. Tests bracket the
// threshold between 0.1em and 0.2em; changing it to make one PDF pass defeats the check.
const WORD_GAP_EM = 0.15
// A run that starts well before the previous one ends is out of order or from a
// different text object, so it is not glued onto the previous word.
const BACKTRACK_EM = 1
// pdf.js marks most line ends with hasEOL; a baseline shift catches the rest.
const LINE_SHIFT_EM = 0.5

function fontSize(item: TextItem): number {
  return Math.hypot(item.transform[2], item.transform[3])
}

export function joinPdfjsItems(items: TextItem[]): string {
  let out = ''
  let prev: TextItem | null = null
  for (const item of items) {
    if (prev && item.str) {
      const em = fontSize(item) || fontSize(prev)
      const rise = Math.abs(item.transform[5] - prev.transform[5])
      const gap = item.transform[4] - (prev.transform[4] + prev.width)
      if (rise > LINE_SHIFT_EM * em) {
        if (!out.endsWith('\n')) out += '\n'
      } else if (
        (gap > WORD_GAP_EM * em || gap < -BACKTRACK_EM * em) &&
        !/\s$/.test(out) &&
        !/^\s/.test(item.str)
      ) {
        out += ' '
      }
    }
    out += item.str
    if (item.hasEOL) {
      out += '\n'
      prev = null
    } else if (item.str) {
      prev = item
    }
  }
  return out
}

export function pdfjsText(pdf: string): Promise<string> {
  return runInWorker('pdfjsText', pdf)
}

export function pdfjsTextInProcess(pdf: string): Promise<string> {
  return withPdfjs(pdf, async (doc) => {
    let text = ''
    for (let n = 1; n <= doc.numPages; n++) {
      const page = joinPdfjsItems(await pdfjsItems(doc, n))
      text += (page.endsWith('\n') ? page : `${page}\n`) + '\f'
    }
    return text
  })
}

// Each option keeps a character that checks [1] (ligature glyphs) and [2] (soft
// hyphen and nbsp) look for; the tests verify all three on a hand-built PDF.
// preserve-ligatures: otherwise U+FB01 becomes "fi". preserve-whitespace:
// otherwise U+00A0 becomes a space.
// ignore-actualtext: otherwise a ligature inside /Span << /ActualText (fi) >>
// comes out as "fi"; testdata/bad/ligatures.pdf (a Chrome print) marks its ligatures this way.
// "inhibit-spaces" and "dehyphenate" stay off, so MuPDF's own word-gap spaces
// are its join rule.
const MUPDF_STEXT = 'preserve-ligatures,preserve-whitespace,ignore-actualtext'

// Keeps MuPDF's warnings out of the report; anything fatal still arrives as a
// thrown error, and so as `<error ...>`.
mupdf.setLog(() => {})

export function mupdfText(pdf: string): Promise<string> {
  return runInWorker('mupdfText', pdf)
}

/** The parts of a MuPDF document that the page loop uses, so tests can stub it. */
export interface MupdfPageSource {
  countPages(): number
  loadPage(n: number): {
    toStructuredText(options: string): { asText(): string; destroy(): void }
    destroy(): void
  }
}

/** Frees every native handle on each path, including a throw from the parser. */
export function mupdfPagesText(doc: MupdfPageSource): string {
  let text = ''
  const pages = doc.countPages()
  for (let n = 0; n < pages; n++) {
    const page = doc.loadPage(n)
    try {
      const stext = page.toStructuredText(MUPDF_STEXT)
      try {
        text += `${stext.asText()}\f`
      } finally {
        stext.destroy()
      }
    } finally {
      page.destroy()
    }
  }
  return text
}

/** Opens a PDF with MuPDF for the caller to destroy; rejects what it cannot read. */
export async function openMupdf(pdf: string): Promise<mupdf.Document> {
  const bytes = await readFile(pdf)
  // The explicit type is meant to guard against MuPDF sniffing a non-PDF and
  // opening it as some other format, such as plain text.
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  try {
    if (doc.needsPassword()) throw new Error('PDF is encrypted with a user password')
    if (doc.countPages() === 0) throw new Error('PDF has no pages')
    return doc
  } catch (e) {
    doc.destroy()
    throw e
  }
}

export async function mupdfTextInProcess(pdf: string): Promise<string> {
  const doc = await openMupdf(pdf)
  try {
    return mupdfPagesText(doc)
  } finally {
    doc.destroy()
  }
}

async function popplerRaw(pdf: string): Promise<string> {
  // Fold whitespace so a term wrapped across lines still matches. ASCII
  // whitespace only: folding U+00A0 too would hide it from check
  // [2] (soft hyphen and nbsp).
  return (await pdfToText(pdf, ['-raw'])).replace(/[ \t\n\r\f\v]+/g, ' ')
}

const ENGINES: ReadonlyArray<{
  name: string
  streamOrder: boolean
  read: (pdf: string) => Promise<string>
}> = [
  { name: 'poppler', streamOrder: false, read: (pdf) => pdfToText(pdf) },
  { name: 'poppler -layout', streamOrder: false, read: (pdf) => pdfToText(pdf, ['-layout']) },
  { name: 'poppler -raw', streamOrder: true, read: popplerRaw },
  { name: 'pdf.js', streamOrder: false, read: pdfjsText },
  { name: 'mupdf', streamOrder: false, read: mupdfText },
]

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message.split('\n')[0]}`
  return String(e)
}

/**
 * Every engine's text, in report order. A failing engine stays in the list as
 * `<error ...>` so the checks that need it fail rather than quietly running on
 * fewer engines. The exception is PopplerMissingError, which rejects the whole
 * call: no file can be verified without poppler, so callers must let it
 * propagate.
 */
export function extractAll(pdf: string): Promise<EngineText[]> {
  return Promise.all(
    ENGINES.map(async ({ name, streamOrder, read }) => {
      try {
        return { name, text: await read(pdf), streamOrder }
      } catch (e) {
        // Not an engine failure: no file can be verified without poppler.
        if (e instanceof PopplerMissingError) throw e
        return { name, text: `<error ${errorText(e)}>`, streamOrder: false }
      }
    }),
  )
}
