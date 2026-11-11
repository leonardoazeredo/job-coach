// Exports a role's CV to PDF. Export trusts the PDF export's own verifier (it checks the
// PDF's text layer and that the ad's keywords survive extraction) plus a freshness check
// on the file. The command looks for Chrome and poppler first and hands over the tools;
// nothing here looks for them.
import { existsSync, statSync } from 'node:fs'
import { exportPdf } from '../cv-pdf/export-pdf.ts'
import type { ExportTools } from '../cv-pdf/pdf-export.ts'
import { hasErrors, type Problem } from './problem.ts'
import { writeProblem } from './read-file.ts'
import type { Workspace } from './workspace.ts'

export type PrintJob = { cvJson: string; keywords: string; pdf: string }

// `report` is what the print said while it ran; exportCv writes it to cv/verify.txt.
// A print that fails for any reason says why there.
export type PrintRun = { ok: boolean; report: string }

// The role CV's problems, from its checks and its writes, travel with every outcome so
// that warnings are shown even on success.
export type ExportOutcome = { problems: Problem[] } & (
  | { kind: 'lint-blocked' }
  | { kind: 'print-failed'; report: string }
  | { kind: 'stale-pdf'; problem: string; report: string }
  | { kind: 'ok'; pdf: string; report: string }
)

// Prints and verifies with the tools it is given. Any failure, including a tool that left
// the machine mid-run, ends as a failed run whose report says why, because exportCv still
// has to write verify.txt.
export const printWith =
  (tools: ExportTools) =>
  async (job: PrintJob): Promise<PrintRun> => {
    const lines: string[] = []
    try {
      await exportPdf(tools, {
        cvJson: job.cvJson,
        keywordsFile: job.keywords,
        pdf: job.pdf,
        log: (line) => lines.push(line),
      })
      return { ok: true, report: `${lines.join('\n')}\n` }
    } catch (e) {
      lines.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
      return { ok: false, report: `${lines.join('\n')}\n` }
    }
  }

// A print can succeed without writing the path it was given, so an export counts only
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
// print only ever sees a CV with no errors whose files are on disk.
// cv.json and keywords.txt are written before it runs, and verify.txt whatever it
// returns.
export const exportCv = async ({
  workspace,
  slug,
  print,
  now = Date.now,
}: {
  workspace: Workspace
  slug: string
  print: (job: PrintJob) => Promise<PrintRun>
  now?: () => number
}): Promise<ExportOutcome> => {
  const rc = workspace.roleCv(slug)
  const written = rc.write()
  if (hasErrors(written)) return { kind: 'lint-blocked', problems: written }

  const { pdf } = rc.files
  // Taken before the print: a PDF last written more than a second before this point
  // counts as stale (see stalePdfProblem).
  const started = now()
  const run = await print({ cvJson: rc.files.cvJson, keywords: rc.files.keywords, pdf })
  // The PDF's own outcome stands; a lost report is one more problem beside it.
  const problems = [...written, ...writeProblem(slug, rc.files.verify, run.report, 'cv/verify.txt')]

  if (!run.ok) return { kind: 'print-failed', report: run.report, problems }
  const stale = stalePdfProblem(pdf, started)
  if (stale) return { kind: 'stale-pdf', problem: stale, report: run.report, problems }
  return { kind: 'ok', pdf, report: run.report, problems }
}
