// The one place that looks for the machine's tools: Chrome to print, poppler to verify.
// Everything else is handed what this finds, so a run can be tested with fakes. The lookup
// happens once, here, and entry points report a missing tool before any work starts; a
// binary removed after the lookup is still caught at run time in poppler.ts.
import { findChrome } from './chrome.ts'
import { chromePagePrinter, type ExportTools } from './pdf-export.ts'
import { findPoppler, installHint, PopplerMissingError } from './verify/poppler.ts'
import { type PdfReader, realPdfReader } from './verify/reader.ts'

// Kept apart because the entry points word and order the two differently. `chrome` is the
// finder's own message; `poppler` names what is absent and how to install it.
export type PopplerMissing = { names: string[]; install: string }
export type MissingTools = { chrome?: string; poppler?: PopplerMissing }

export type ToolSearch = { tools: ExportTools } | { missing: MissingTools }
export type ReaderSearch = { reader: PdfReader } | { missing: { poppler: PopplerMissing } }

// With no argument, looks for Chrome and poppler and reports both when both are absent. With
// 'poppler', looks only for poppler: the lookup then needs no browser, which the verify command does not use.
export function findTools(): ToolSearch
export function findTools(only: 'poppler'): ReaderSearch
export function findTools(only?: 'poppler'): ToolSearch | ReaderSearch {
  const chrome = only === 'poppler' ? undefined : findChrome()
  const found = findPoppler()
  const poppler: PopplerMissing | undefined =
    'missing' in found
      ? { names: found.missing, install: installHint(process.platform) }
      : undefined
  if (!chrome) return poppler ? { missing: { poppler } } : { reader: realPdfReader }
  if ('error' in chrome)
    return { missing: { chrome: chrome.error, ...(poppler ? { poppler } : {}) } }
  if (poppler) return { missing: { poppler } }
  return { tools: { printer: chromePagePrinter(chrome.path), reader: realPdfReader } }
}

export type FindTools = typeof findTools

export const popplerMissingError = (p: PopplerMissing): PopplerMissingError =>
  new PopplerMissingError(p.names, p.install)
