#!/usr/bin/env node
/**
 * Verify that CV PDFs survive ATS text extraction.
 *
 *   node verify/cli.ts --data <cv.json> [--] <file.pdf>...
 *
 * Exit codes (EXIT in lib/problem.ts): 0 every check passed, 1 a check failed,
 * 64 bad usage, 65 --data is not valid JSON or not an object, 66 poppler is
 * missing or --data could not be read.
 */
import { readFileSync } from 'node:fs'
import { EXIT } from '../../lib/problem.ts'
import type { CvData } from '../types.ts'
import { expectations } from './expectations.ts'
import { PopplerMissingError } from './poppler.ts'
import { verifyEach } from './run.ts'

const USAGE = [
  'usage: node verify/cli.ts --data <cv.json> [--] <file.pdf>...',
  '  --data <cv.json>  required: derive expectations from a CV data file (a JSON object)',
  '  exit: 0 pass, 1 failing check, 64 usage, 65 bad --data, 66 poppler missing or --data unreadable',
].join('\n')

// `never` is declared explicitly: TS narrows after a call only when the
// function's signature says it does not return.
function fail(code: number, msg: string): never {
  console.error(`\n  ERROR: ${msg}\n`)
  process.exit(code)
}

const argv = process.argv.slice(2)
// A bare `--` ends option parsing: everything after it is a file name, even
// `--data` or `--weird.pdf`.
const endAt = argv.indexOf('--')
const opts = endAt === -1 ? argv : argv.slice(0, endAt)
const files = endAt === -1 ? [] : argv.slice(endAt + 1)

if (opts.some((a) => a.startsWith('--data='))) {
  fail(EXIT.usage, 'use --data <path>, not --data=<path>')
}
let dataArg: string | undefined
const dataAt = opts.indexOf('--data')
if (dataAt !== -1) {
  dataArg = opts[dataAt + 1]
  if (!dataArg || dataArg.startsWith('--')) fail(EXIT.usage, '--data needs a path')
  opts.splice(dataAt, 2)
}
const unknown = opts.find((a) => a.startsWith('--'))
if (unknown) fail(EXIT.usage, `unknown option ${unknown}\n         ${USAGE}`)
// Checked before any PDF is touched: with no data file there are no real expectations to hold it to.
if (!dataArg) fail(EXIT.usage, `--data <cv.json> is required\n         ${USAGE}`)
files.unshift(...opts)
if (files.length === 0) {
  console.error(USAGE)
  process.exit(EXIT.usage)
}

let exp: ReturnType<typeof expectations>
let raw: string
try {
  raw = readFileSync(dataArg, 'utf8')
} catch (e) {
  fail(
    EXIT.missing,
    `could not read --data ${dataArg}: ${e instanceof Error ? e.message : String(e)}`,
  )
}
let parsed: unknown
try {
  parsed = JSON.parse(raw)
} catch (e) {
  fail(
    EXIT.data,
    `--data ${dataArg} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
  )
}
if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
  fail(EXIT.data, `--data ${dataArg} should hold a JSON object`)
}
try {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: parsed passed the object guard above, and expectations tolerates missing fields
  exp = expectations(parsed as Partial<CvData>)
} catch (e) {
  fail(EXIT.data, `--data ${dataArg} is not a CV: ${e instanceof Error ? e.message : String(e)}`)
}
console.log(
  `expectations from ${dataArg}: ${exp.keywords.length} keywords, ${exp.pairs.length} job pairs`,
)

let total = 0
try {
  total = await verifyEach(files, exp)
} catch (e) {
  if (!(e instanceof PopplerMissingError)) throw e
  fail(EXIT.missing, e.message)
}
process.exitCode = total > 0 ? EXIT.problems : 0
