import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { promisify } from 'node:util'
import { EXTRACT_TIMEOUT_MS } from './constants.ts'

const run = promisify(execFile)

// Distinct from 1, which means a failing check.
const EXIT_NO_POPPLER = 2

const TOOLS = ['pdftotext', 'pdfinfo'] as const
const BREW_INSTALL = ['brew', 'install', 'poppler']
const LINUX_HINT = 'sudo apt install poppler-utils   (or: sudo dnf install poppler-utils)'
const OTHER_HINT = 'install poppler (pdftotext and pdfinfo) with your package manager'

const MAX_BUFFER = 64 * 1024 * 1024

export type PopplerPaths = { pdftotext: string; pdfinfo: string }
export type FindResult = PopplerPaths | { missing: string[] }

export interface PopplerDeps {
  find: () => FindResult
  isInteractive: boolean
  ask: (question: string) => Promise<boolean>
  install: (cmd: string[]) => Promise<number>
  platform: string
  log: (msg: string) => void
}

export class PopplerMissingError extends Error {
  constructor(missing: string[], installCommand: string, options?: ErrorOptions) {
    super(
      `poppler is required but ${missing.join(' and ')} could not be found; install with: ${installCommand}`,
      options,
    )
    this.name = 'PopplerMissingError'
  }
}

export function installHint(platform: string): string {
  if (platform === 'darwin') return BREW_INSTALL.join(' ')
  return platform === 'linux' ? LINUX_HINT : OTHER_HINT
}

/**
 * Prints a PopplerMissingError and exits with EXIT_NO_POPPLER. The error's
 * message already carries the install command.
 */
export function exitForMissingPoppler(e: PopplerMissingError): never {
  console.error(`\n  ERROR: ${e.message}\n`)
  process.exit(EXIT_NO_POPPLER)
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

export function findPoppler(pathEnv: string = process.env.PATH ?? ''): FindResult {
  const dirs = pathEnv.split(delimiter).filter(Boolean)
  const found: Partial<PopplerPaths> = {}
  const missing: string[] = []
  for (const tool of TOOLS) {
    const hit = dirs.map((d) => join(d, tool)).find(isExecutable)
    if (hit) found[tool] = hit
    else missing.push(tool)
  }
  return missing.length > 0 ? { missing } : (found as PopplerPaths)
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim())
  } finally {
    rl.close()
  }
}

function installWith(cmd: string[]): Promise<number> {
  return new Promise((resolve) => {
    const [bin = '', ...rest] = cmd
    const child = spawn(bin, rest, { stdio: 'inherit' })
    // Node reports a spawn failure (ENOENT when Homebrew is absent) as an
    // "error" event, not an exit; 127 is the conventional "command not found".
    child.on('error', () => resolve(127))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const DEFAULT_DEPS: PopplerDeps = {
  find: () => findPoppler(),
  isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  ask: askYesNo,
  install: installWith,
  platform: process.platform,
  log: (msg) => console.error(msg),
}

/**
 * Never installs without an explicit yes at a terminal, and never lets the
 * caller continue without both tools: a skipped verifier reads as a pass.
 * Throws PopplerMissingError, whose message the caller prints.
 */
export async function ensurePoppler(deps: Partial<PopplerDeps> = {}): Promise<void> {
  const d: PopplerDeps = { ...DEFAULT_DEPS, ...deps }
  const first = d.find()
  if (!('missing' in first)) return

  const darwin = d.platform === 'darwin'
  const command = installHint(d.platform)
  if (!darwin || !d.isInteractive) throw new PopplerMissingError(first.missing, command)

  d.log(`poppler is required to verify the PDF; missing: ${first.missing.join(', ')}`)
  // The command is left out of the prompt: the error thrown on a "no" carries it.
  if (!(await d.ask('Install poppler with Homebrew? [y/N] '))) {
    throw new PopplerMissingError(first.missing, command)
  }
  const code = await d.install(BREW_INSTALL)
  if (code !== 0) {
    d.log(`brew exited with code ${code}`)
    throw new PopplerMissingError(first.missing, command)
  }
  const second = d.find()
  if ('missing' in second) {
    d.log(`still missing after install: ${second.missing.join(', ')}`)
    throw new PopplerMissingError(second.missing, command)
  }
}

async function poppler(tool: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(tool, args, {
      encoding: 'utf8',
      timeout: EXTRACT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    return stdout
  } catch (e) {
    // execFile's message is "Command failed: <argv>" followed by all of stderr;
    // poppler's reason is its last stderr line, so take that from err.stderr.
    const err = e as { code?: unknown; killed?: boolean; stderr?: string }
    // ENOENT means the binary left PATH after ensurePoppler found it. Throwing
    // PopplerMissingError rather than a poppler failure lets the callers rethrow
    // it so the CLI exits 2 instead of reporting a failing check.
    if (err.code === 'ENOENT')
      throw new PopplerMissingError([tool], installHint(process.platform), { cause: e })
    const reason = err.killed
      ? `timed out after ${EXTRACT_TIMEOUT_MS / 1000}s`
      : (err.stderr ?? '').trim().split('\n').at(-1) ||
        (typeof err.code === 'number' ? `exit ${err.code}` : String(err.code))
    throw new Error(`${tool} failed: ${reason}`, { cause: e })
  }
}

export async function pdfInfo(
  pdf: string,
): Promise<{ pages: number; size: string; tagged: string }> {
  const info = await poppler('pdfinfo', ['--', pdf])
  return {
    pages: Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0),
    size: /^Page size:\s+(.+)$/m.exec(info)?.[1]?.trim() ?? '?',
    tagged: /^Tagged:\s+(\w+)/m.exec(info)?.[1] ?? '?',
  }
}

/** Text of the whole PDF on stdout; `args` are pdftotext flags such as `-layout`. */
export function pdfToText(pdf: string, args: string[] = []): Promise<string> {
  return poppler('pdftotext', [...args, '--', pdf, '-'])
}
