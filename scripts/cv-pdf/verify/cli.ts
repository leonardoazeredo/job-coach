#!/usr/bin/env node
/**
 * Verify that CV PDFs survive ATS text extraction.
 *
 *   node verify/cli.ts --data <cv.json> [--] <file.pdf>...
 *
 * Exit codes (EXIT in lib/problem.ts): 0 every check passed, 1 a check failed,
 * 64 bad usage, 65 --data is not valid JSON, not an object or not a CV, 66 poppler is
 * missing or --data could not be read.
 */
import { readFileSync } from 'node:fs'
import { EXIT } from '../../lib/problem.ts'
import { parseArgs } from '../args.ts'
import { type FindTools, findTools, popplerMissingError } from '../tools.ts'
import type { CvData } from '../types.ts'
import { expectations } from './expectations.ts'
import { PopplerMissingError } from './poppler.ts'
import { verifyEach } from './run.ts'

export const USAGE = [
  'usage: node verify/cli.ts --data <cv.json> [--] <file.pdf>...',
  '  --data <cv.json>  required: derive expectations from a CV data file (a JSON object)',
  '  exit: 0 pass, 1 failing check, 64 usage, 65 bad --data, 66 poppler missing or --data unreadable',
].join('\n')

const fail = (code: number, msg: string): number => {
  console.error(`\n  ERROR: ${msg}\n`)
  return code
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Reads and checks --data; the exit code to end with when it cannot be used.
const readExpectations = (
  dataArg: string,
): { exp: ReturnType<typeof expectations> } | { code: number } => {
  let raw: string
  try {
    raw = readFileSync(dataArg, 'utf8')
  } catch (e) {
    return { code: fail(EXIT.missing, `could not read --data ${dataArg}: ${reason(e)}`) }
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    return { code: fail(EXIT.data, `--data ${dataArg} is not valid JSON: ${reason(e)}`) }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { code: fail(EXIT.data, `--data ${dataArg} should hold a JSON object`) }
  }
  try {
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: data passed the object guard above, and expectations tolerates missing fields
    return { exp: expectations(data as Partial<CvData>) }
  } catch (e) {
    return { code: fail(EXIT.data, `--data ${dataArg} is not a CV: ${reason(e)}`) }
  }
}

// The exit code for these arguments. Poppler is looked for after --data is read, as the
// first PDF would have been, so a bad --data is reported whether or not poppler is there.
export const verifyCommand = async (
  argv: string[],
  find: FindTools = findTools,
): Promise<number> => {
  const parsed = parseArgs(argv, { flags: ['--data'], endMarker: true, rejectEquals: true })
  if ('problem' in parsed) {
    return fail(
      EXIT.usage,
      parsed.problem.kind === 'equals-form'
        ? 'use --data <path>, not --data=<path>'
        : '--data needs a path',
    )
  }
  const unknown = parsed.rest.find((a) => a.startsWith('--'))
  if (unknown) return fail(EXIT.usage, `unknown option ${unknown}\n         ${USAGE}`)
  const dataArg = parsed.values['--data']
  // Checked before any PDF is touched: with no data file there are no real expectations to hold it to.
  if (!dataArg) return fail(EXIT.usage, `--data <cv.json> is required\n         ${USAGE}`)
  const files = [...parsed.rest, ...parsed.afterEnd]
  if (files.length === 0) {
    console.error(USAGE)
    return EXIT.usage
  }

  const read = readExpectations(dataArg)
  if ('code' in read) return read.code
  const { exp } = read
  console.log(
    `expectations from ${dataArg}: ${exp.keywords.length} keywords, ${exp.pairs.length} job pairs`,
  )

  const found = find('poppler')
  if ('missing' in found) {
    return fail(EXIT.missing, popplerMissingError(found.missing.poppler).message)
  }
  try {
    return (await verifyEach(files, exp, found.reader)) > 0 ? EXIT.problems : 0
  } catch (e) {
    if (!(e instanceof PopplerMissingError)) throw e
    return fail(EXIT.missing, e.message)
  }
}

if (import.meta.main) process.exitCode = await verifyCommand(process.argv.slice(2))
