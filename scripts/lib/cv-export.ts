// Exports a role's CV to PDF. Export trusts the printer's own verifier (it checks the
// PDF's text layer and that the ad's keywords survive extraction) plus a freshness check
// on the file.
import { existsSync, statSync } from 'node:fs'
import { type ChromeFound, findChrome } from '../cv-pdf/chrome.ts'
import type { ExportOptions } from '../cv-pdf/export-pdf.ts'
import { type FindResult, findPoppler, installHint } from '../cv-pdf/verify/poppler.ts'
import { hasErrors, type Problem } from './problem.ts'
import { writeProblem } from './read-file.ts'
import type { Workspace } from './workspace.ts'

export type PrintJob = { cvJson: string; keywords: string; pdf: string }

// `report` is what the printer said while it ran; exportCv writes it to cv/verify.txt.
// A printer that fails for any reason, including one that could not start, says why there.
export type PrintRun = { ok: boolean; report: string }

export type PdfPrinter = {
  // Why the printer cannot run here, or undefined when it can.
  unavailable: () => string | undefined
  print: (job: PrintJob) => Promise<PrintRun>
}

// The role CV's problems, from its checks and its writes, travel with every outcome so
// that warnings are shown even on success. They are empty for printer-missing, which is
// decided before the checks run.
export type ExportOutcome = { problems: Problem[] } & (
  | { kind: 'printer-missing'; reason: string }
  | { kind: 'lint-blocked' }
  | { kind: 'print-failed'; report: string }
  | { kind: 'stale-pdf'; problem: string; report: string }
  | { kind: 'ok'; pdf: string; report: string }
)

// What the in-process printer reads from the machine, so a test can describe one without
// Chrome. `exportPdf` is imported only when printing: it pulls in Vite and the verifier.
export type ChromePrinterDeps = {
  chrome: () => ChromeFound
  poppler: () => FindResult
  platform: string
  exportPdf: (opts: ExportOptions) => Promise<void>
}

const realDeps: ChromePrinterDeps = {
  chrome: () => findChrome(),
  poppler: () => findPoppler(),
  platform: process.platform,
  exportPdf: async (opts) => (await import('../cv-pdf/export-pdf.ts')).exportPdf(opts),
}

// Prints with Chrome and verifies with poppler, both on this machine. Either one missing
// makes the whole export unavailable, because an unverified PDF reads as a good one.
export const chromePrinter = (over: Partial<ChromePrinterDeps> = {}): PdfPrinter => {
  const deps = { ...realDeps, ...over }
  return {
    unavailable: () => {
      const chrome = deps.chrome()
      if ('error' in chrome) return chrome.error
      const poppler = deps.poppler()
      if (!('missing' in poppler)) return
      const names = poppler.missing.join(' and ')
      return `poppler is required to verify the PDF but ${names} could not be found; install with: ${installHint(deps.platform)}`
    },
    print: async (job) => {
      const chrome = deps.chrome()
      if ('error' in chrome) return { ok: false, report: `${chrome.error}\n` }
      const lines: string[] = []
      try {
        await deps.exportPdf({
          cvJson: job.cvJson,
          keywordsFile: job.keywords,
          pdf: job.pdf,
          chrome: chrome.path,
          log: (line) => lines.push(line),
        })
        return { ok: true, report: `${lines.join('\n')}\n` }
      } catch (e) {
        lines.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
        return { ok: false, report: `${lines.join('\n')}\n` }
      }
    },
  }
}

// A printer can succeed without writing the path it was given, so an export counts only
// if the PDF exists, is not empty, and was written after `startedMs`.
// One second of slack covers filesystems that store mtimes in whole seconds.
export const stalePdfProblem = (path: string, startedMs: number): string | undefined => {
  if (!existsSync(path)) return `no PDF at ${path}`
  const { mtimeMs, size } = statSync(path)
  if (mtimeMs < startedMs - 1000) return `${path} was not rewritten by this export`
  if (size === 0) return `${path} is empty`
  return undefined
}

// write() refuses on any error and reports a file it could not write as one, so the
// printer only ever sees a CV with no errors whose files are on disk.
// cv.json and keywords.txt are written before it runs, and verify.txt whatever it
// returns.
export const exportCv = async ({
  workspace,
  slug,
  printer,
  now = Date.now,
}: {
  workspace: Workspace
  slug: string
  printer: PdfPrinter
  now?: () => number
}): Promise<ExportOutcome> => {
  const reason = printer.unavailable()
  if (reason) return { kind: 'printer-missing', reason, problems: [] }
  const rc = workspace.roleCv(slug)
  const written = rc.write()
  if (hasErrors(written)) return { kind: 'lint-blocked', problems: written }

  const { pdf } = rc.files
  // Taken before the print: a PDF last written more than a second before this point
  // counts as stale (see stalePdfProblem).
  const started = now()
  const run = await printer.print({ cvJson: rc.files.cvJson, keywords: rc.files.keywords, pdf })
  // The PDF's own outcome stands; a lost report is one more problem beside it.
  const problems = [...written, ...writeProblem(slug, rc.files.verify, run.report, 'cv/verify.txt')]

  if (!run.ok) return { kind: 'print-failed', report: run.report, problems }
  const stale = stalePdfProblem(pdf, started)
  if (stale) return { kind: 'stale-pdf', problem: stale, report: run.report, problems }
  return { kind: 'ok', pdf, report: run.report, problems }
}
