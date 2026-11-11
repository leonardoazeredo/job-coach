import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { EXTRACT_TIMEOUT_MS } from './constants.ts'

const run = promisify(execFile)

const TOOLS = ['pdftotext', 'pdfinfo'] as const
const BREW_INSTALL = 'brew install poppler'
const LINUX_HINT = 'sudo apt install poppler-utils   (or: sudo dnf install poppler-utils)'
const OTHER_HINT = 'install poppler (pdftotext and pdfinfo) with your package manager'

const MAX_BUFFER = 64 * 1024 * 1024

export type PopplerPaths = { pdftotext: string; pdfinfo: string }
export type FindResult = PopplerPaths | { missing: string[] }

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
  if (platform === 'darwin') return BREW_INSTALL
  return platform === 'linux' ? LINUX_HINT : OTHER_HINT
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
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: found holds every tool whenever missing is empty
  return missing.length > 0 ? { missing } : (found as PopplerPaths)
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
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: a caught execFile rejection; every field is read defensively
    const err = e as { code?: unknown; killed?: boolean; stderr?: string }
    // ENOENT means the binary left PATH after findPoppler found it. Throwing
    // PopplerMissingError rather than a poppler failure lets the callers rethrow
    // it so the CLI exits EXIT.missing instead of reporting a failing check.
    if (err.code === 'ENOENT')
      throw new PopplerMissingError([tool], installHint(process.platform), { cause: e })
    // execFile's message is "Command failed: <argv>" followed by all of stderr;
    // poppler's reason is its last stderr line, so take that from err.stderr.
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
