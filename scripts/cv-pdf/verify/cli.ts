#!/usr/bin/env node
/**
 * Verify that CV PDFs survive ATS text extraction.
 *
 *   node verify/cli.ts [--data <cv.json>] [--] <file.pdf>...
 *
 * Exit codes: 0 every check passed, 1 a check failed, 2 poppler is missing,
 * 64 bad usage, 65 --data is not valid JSON or not an object, 66 --data could
 * not be read.
 */
import { readFileSync } from 'node:fs'
import type { CvData } from '../types.ts'
import { expectations } from './expectations.ts'
import { FALLBACK_EXPECTATIONS } from './fallback.ts'
import { exitForMissingPoppler, PopplerMissingError } from './poppler.ts'
import { verifyEach } from './run.ts'
import type { Expectations } from './types.ts'

const EXIT_USAGE = 64
const EXIT_DATA_FORMAT = 65
const EXIT_NO_INPUT = 66

const USAGE = [
  'usage: node verify/cli.ts [--data <cv.json>] [--] <file.pdf>...',
  '  --data <cv.json>  derive expectations from a CV data file (a JSON object)',
  '  exit: 0 pass, 1 failing check, 2 poppler missing, 64 usage, 65/66 bad --data',
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
  fail(EXIT_USAGE, 'use --data <path>, not --data=<path>')
}
let dataArg: string | undefined
const dataAt = opts.indexOf('--data')
if (dataAt !== -1) {
  dataArg = opts[dataAt + 1]
  if (!dataArg || dataArg.startsWith('--')) fail(EXIT_USAGE, '--data needs a path')
  opts.splice(dataAt, 2)
}
const unknown = opts.find((a) => a.startsWith('--'))
if (unknown) fail(EXIT_USAGE, `unknown option ${unknown}\n         ${USAGE}`)
files.unshift(...opts)
if (files.length === 0) {
  console.error(USAGE)
  process.exit(EXIT_USAGE)
}

let exp: Expectations = FALLBACK_EXPECTATIONS
if (dataArg) {
  let raw: string
  try {
    raw = readFileSync(dataArg, 'utf8')
  } catch (e) {
    fail(
      EXIT_NO_INPUT,
      `could not read --data ${dataArg}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    fail(
      EXIT_DATA_FORMAT,
      `--data ${dataArg} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(EXIT_DATA_FORMAT, `--data ${dataArg} should hold a JSON object`)
  }
  try {
    exp = expectations(parsed as Partial<CvData>)
  } catch (e) {
    fail(
      EXIT_DATA_FORMAT,
      `--data ${dataArg} is not a CV: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  console.log(
    `expectations from ${dataArg}: ${exp.keywords.length} keywords, ${exp.pairs.length} job pairs`,
  )
}

let total = 0
try {
  total = await verifyEach(files, exp)
} catch (e) {
  if (e instanceof PopplerMissingError) exitForMissingPoppler(e)
  throw e
}
process.exitCode = total > 0 ? 1 : 0
