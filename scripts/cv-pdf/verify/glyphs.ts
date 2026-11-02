import type { PDFObject, PDFPage } from 'mupdf'
import { openMupdf, pdfjsItems, withPdfjs } from './extractors.ts'
import { runInWorker } from './runInWorker.ts'
import type { LinkTarget } from './types.ts'

/**
 * Glyph count per font size in points, rounded to 0.1pt. The size is the
 * vertical scale of the text item's transform, which pdf.js derives from the
 * font size and the text matrix.
 */
export function glyphSizes(pdf: string): Promise<Map<number, number>> {
  return runInWorker('glyphSizes', pdf)
}

export function glyphSizesInProcess(pdf: string): Promise<Map<number, number>> {
  return withPdfjs(pdf, async (doc) => {
    const sizes = new Map<number, number>()
    for (let n = 1; n <= doc.numPages; n++) {
      for (const item of await pdfjsItems(doc, n)) {
        if (item.str.length === 0) continue
        const size = Math.round(Math.hypot(item.transform[2], item.transform[3]) * 10) / 10
        sizes.set(size, (sizes.get(size) ?? 0) + item.str.length)
      }
    }
    return sizes
  })
}

/**
 * One entry per link annotation. Only a /URI action is a target. The action type
 * is read from the raw dictionary because pdf.js copies a /Launch or /GoToR
 * file target into its `url` field, so a non-URI action would pass for a
 * contact link.
 */
export function linkTargets(pdf: string): Promise<LinkTarget[]> {
  return runInWorker('linkTargets', pdf)
}

// null means the annotation is not a link.
function linkTarget(annot: PDFObject): LinkTarget | null {
  if (!annot.get('Subtype').isName() || annot.get('Subtype').asName() !== 'Link') return null
  const action = annot.get('A')
  // No /A action: an internal jump, or a link with no target at all.
  if (action.isNull()) return { jump: true }
  const type = action.get('S')
  const name = type.isName() ? type.asName() : '?'
  const uri = action.get('URI')
  if (name !== 'URI') return { action: name }
  return uri.isString() ? { uri: uri.asString() } : { malformedUri: true }
}

export async function linkTargetsInProcess(pdf: string): Promise<LinkTarget[]> {
  const doc = await openMupdf(pdf)
  try {
    const links: LinkTarget[] = []
    const pages = doc.countPages()
    for (let n = 0; n < pages; n++) {
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: openMupdf opens a PDF, whose pages are PDFPage
      const page = doc.loadPage(n) as PDFPage
      try {
        // biome-ignore lint/complexity/noForEach: PDFObject has forEach but is not iterable
        page
          .getObject()
          .get('Annots')
          .forEach((annot) => {
            const link = linkTarget(annot)
            if (link) links.push(link)
          })
      } finally {
        page.destroy()
      }
    }
    return links
  } finally {
    doc.destroy()
  }
}
