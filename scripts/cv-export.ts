// Builds a role's CV and exports it to PDF with Chrome, then verifies the PDF's text layer
// before it reports success (see lib/cv-export.ts and cv-pdf/).
// Once the lint passes, writes cv/cv.json and cv/keywords.txt in the role folder, and
// cv/verify.txt with the printer's report; the PDF lands in cv/, named after identity.yaml
// (see pdfFileName in lib/identity.ts).
// A failed run can leave an older PDF in place, so this script exits 0 only when the
// PDF was modified no earlier than a second before this run started.
//
// Usage: node scripts/cv-export.ts <slug>
// Needs Chrome (or CHROME_PATH pointing at a Chrome executable) and poppler. PDF export is
// optional: the rest of the pipeline works without either.
// Exits 64 without a slug, 66 when Chrome or poppler is missing, and 1 for any other
// failure.
import { chromePrinter, type ExportOutcome, exportCv } from './lib/cv-export.ts'
import { EXIT, printProblems } from './lib/problem.ts'
import { type Command, openWorkspace } from './lib/workspace.ts'

const failure = (o: ExportOutcome): { message: string; code: number } | undefined => {
  switch (o.kind) {
    case 'printer-missing':
      return { message: o.reason, code: EXIT.missing }
    case 'lint-blocked':
      return { message: 'stopped before printing; fix the errors above', code: EXIT.problems }
    case 'print-failed':
      return { message: 'the export failed; report in cv/verify.txt', code: EXIT.problems }
    case 'stale-pdf':
      return {
        message: `the printer reported success but ${o.problem}`,
        code: EXIT.problems,
      }
    case 'ok':
      return undefined
  }
}

export const cvExport: Command = async (args, workspace) => {
  const slug = args[0]
  if (!slug) {
    console.error('usage: node scripts/cv-export.ts <slug>')
    return EXIT.usage
  }
  const outcome = await exportCv({ workspace, slug, printer: chromePrinter() })

  printProblems(outcome.problems, true)
  if ('report' in outcome) process.stdout.write(outcome.report)

  const failed = failure(outcome)
  if (failed) {
    console.error(`cv-export: ${failed.message}`)
    return failed.code
  }
  if (outcome.kind === 'ok') console.log(`cv-export: wrote ${outcome.pdf}`)
  return 0
}

if (import.meta.main) process.exitCode = await cvExport(process.argv.slice(2), openWorkspace())
