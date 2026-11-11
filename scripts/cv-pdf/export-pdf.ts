#!/usr/bin/env node
// Maintainer entry point for the CV PDF export, taking file paths; the export itself is in
// pdf-export.ts and `cv-export` reaches it through scripts/lib/cv-export.ts, which calls
// exportPdf below.
//
// Usage: node scripts/cv-pdf/export-pdf.ts --data <cv.json> [--keywords <file>] [out.pdf]
import { readFileSync } from 'node:fs'
import { type CvData, CvDataSchema } from '../lib/cv-schema.ts'
import { pdfFileName } from '../lib/identity.ts'
import { EXIT } from '../lib/problem.ts'
import { parseArgs } from './args.ts'
import { ExportError, type ExportTools, runExport } from './pdf-export.ts'
import { type FindTools, findTools, popplerMissingError } from './tools.ts'
import { PopplerMissingError } from './verify/poppler.ts'

export { ExportError }

export type ExportOptions = {
  cvJson: string
  // One keyword per line: ad keywords that must survive text extraction, on top of the CV's skills.
  keywordsFile?: string
  pdf: string
  log: (line: string) => void
}

export const readCv = (path: string): CvData => {
  const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    throw new ExportError(`could not read ${path}: ${reason(e)}`, EXIT.missing)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new ExportError(`${path} is not valid JSON: ${reason(e)}`, EXIT.data)
  }
  const result = CvDataSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ExportError(`${path} is not a valid CV: ${issues}`, EXIT.data)
  }
  return result.data
}

const readKeywords = (path: string | undefined): string[] =>
  path
    ? readFileSync(path, 'utf8')
        .split('\n')
        .map((k) => k.trim())
        .filter(Boolean)
    : []

export const exportPdf = async (tools: ExportTools, opts: ExportOptions): Promise<void> => {
  const cv = readCv(opts.cvJson)
  await runExport(tools, {
    cv,
    keywords: readKeywords(opts.keywordsFile),
    pdf: opts.pdf,
    log: opts.log,
  })
}

const exitCodeFor = (e: unknown): number => {
  if (e instanceof PopplerMissingError) return EXIT.missing
  return e instanceof ExportError ? e.code : EXIT.problems
}

export const USAGE =
  'usage: node scripts/cv-pdf/export-pdf.ts --data <cv.json> [--keywords <file>] [out.pdf]'

const fail = (e: unknown): number => {
  console.error(`\n  ERROR: ${e instanceof Error ? e.message : String(e)}\n`)
  return exitCodeFor(e)
}

// The exit code for these arguments. Looks for the tools once, then reports in the order that
// costs least: poppler before the CV is read, so a missing verifier shows even for a CV that
// would fail validation, and Chrome after it, both before the build, which takes a minute.
export const exportPdfCommand = async (
  argv: string[],
  find: FindTools = findTools,
): Promise<number> => {
  const parsed = parseArgs(argv, { flags: ['--data', '--keywords'] })
  if ('problem' in parsed) {
    console.error(`\n  ERROR: ${parsed.problem.flag} needs a path\n  ${USAGE}\n`)
    return EXIT.usage
  }
  const cvJson = parsed.values['--data']
  const keywordsFile = parsed.values['--keywords']
  if (!cvJson || parsed.rest.some((a) => a.startsWith('--'))) {
    console.error(USAGE)
    return EXIT.usage
  }
  try {
    const found = find()
    if ('missing' in found && found.missing.poppler) {
      throw popplerMissingError(found.missing.poppler)
    }
    const cv = readCv(cvJson)
    const pdf = parsed.rest[0] ?? pdfFileName(cv.name)
    if ('missing' in found) throw new ExportError(found.missing.chrome ?? '', EXIT.missing)
    await exportPdf(found.tools, {
      cvJson,
      pdf,
      log: (line) => console.log(line),
      ...(keywordsFile ? { keywordsFile } : {}),
    })
    return 0
  } catch (e) {
    return fail(e)
  }
}

if (import.meta.main) process.exitCode = await exportPdfCommand(process.argv.slice(2))
