import { extractAll } from './extractors.ts'
import { glyphSizes, linkTargets } from './glyphs.ts'
import { pdfInfo, pdfToText } from './poppler.ts'
import type { EngineText, LinkTarget } from './types.ts'

/**
 * Everything verifyPdf reads from a PDF. A read that cannot be made rejects.
 * A failed `info` or per-check read (links, glyph sizes, page text) becomes a
 * failed check; a rejected textInEveryEngine propagates to verifyEach, which
 * fails the file as "could not verify" (the real reader rejects there only with
 * PopplerMissingError). PopplerMissingError from a poppler read propagates so
 * the entry point can exit 66.
 */
export interface PdfReader {
  info(pdf: string): Promise<{ pages: number; size: string; tagged: string }>
  /** One page (1-based). With `bbox`, the raw word-box markup of that page instead of its text. */
  pageText(pdf: string, page: number, opts?: { bbox?: boolean }): Promise<string>
  textInEveryEngine(pdf: string): Promise<EngineText[]>
  glyphSizes(pdf: string): Promise<Map<number, number>>
  linkTargets(pdf: string): Promise<LinkTarget[]>
}

export const realPdfReader: PdfReader = {
  info: pdfInfo,
  pageText: (pdf, page, opts) => {
    const p = String(page)
    return pdfToText(pdf, [...(opts?.bbox ? ['-bbox'] : []), '-f', p, '-l', p])
  },
  textInEveryEngine: extractAll,
  glyphSizes,
  linkTargets,
}
