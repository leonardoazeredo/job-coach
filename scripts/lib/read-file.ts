// Reads one data file, or a directory of them, under the workspace's error policy:
// it comes back as data, a one-line error or a missing flag, never a throw. No
// defaults are invented, so the validator can report what is missing. Writing an
// output file follows the same policy.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { error, type Problem } from './problem.ts'

export type Read<T> = { data?: T; error?: string; missing?: true }

// One line per file, so a problem fits a board row or a log line.
export const describe = (error: unknown): string => {
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ')
  // YAML errors append a code excerpt on later lines; the first line names the fault.
  const message = error instanceof Error ? error.message : String(error)
  return (message.split('\n')[0] ?? message).replace(/:$/, '')
}

export const readFile = <T>(path: string, parseWith: (text: string) => T): Read<T> => {
  if (!existsSync(path)) return { missing: true }
  try {
    return { data: parseWith(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { error: describe(error) }
  }
}

export const readDir = (
  dir: string,
  keep: (name: string) => boolean,
): Read<Record<string, string>> => {
  if (!existsSync(dir)) return { missing: true }
  try {
    const names = readdirSync(dir).filter(keep).sort()
    return {
      data: Object.fromEntries(
        names.map((name) => [name.replace(/\.[^.]*$/, ''), readFileSync(join(dir, name), 'utf8')]),
      ),
    }
  } catch (error) {
    return { error: describe(error) }
  }
}

// describe()'s one-line reason when the write fails.
const writeFailure = (path: string, text: string): string | undefined => {
  try {
    writeFileSync(path, text)
    return undefined
  } catch (error) {
    return describe(error)
  }
}

export const yaml =
  <T>(schema: z.ZodType<T>) =>
  (text: string): T =>
    schema.parse(parse(text))

export const MISSING = 'is missing'

// The write counterpart of fileProblem: a failed write is a Problem worded like a failed
// read, with the file name when the slug alone does not say which file.
export const writeProblem = (
  slug: string,
  path: string,
  text: string,
  file?: string,
): Problem[] => {
  const why = writeFailure(path, text)
  if (why === undefined) return []
  return [error(slug, `${file === undefined ? '' : `${file} `}could not be written: ${why}`)]
}

const readFailure = (read: Read<unknown>): string | undefined => {
  if (read.data !== undefined) return undefined
  if (read.missing) return MISSING
  return `could not be read: ${read.error}`
}

// Role files share the role's slug, so the file name goes in the message; other files are
// keyed by their repo path and need no name.
export const fileProblem = (slug: string, read: Read<unknown>, file?: string): Problem[] => {
  const why = readFailure(read)
  if (why === undefined) return []
  return [error(slug, file === undefined ? why : `${file} ${why}`)]
}
