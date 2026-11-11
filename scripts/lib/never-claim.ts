// A never-claim pattern in profile/stack.yaml that matches a true line of cv/master.json would
// fail every CV built for a role (cv-lint checks the built text against the patterns), so the
// two files must not disagree. Whichever is drafted second is refused. The refusal names the
// pattern and the line, so the coach narrows the pattern to the claim itself.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { isObj } from './draft-fields.ts'

type NeverClaim = { item: string; patterns: string[] }
type Hit = NeverClaim & { pattern: string; line: string }

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  return isObj(value) ? Object.values(value).flatMap(strings) : []
}

const neverClaimsIn = (stack: unknown): NeverClaim[] => {
  const list = isObj(stack) ? stack.do_not_claim : undefined
  return (Array.isArray(list) ? list : []).flatMap((entry) =>
    isObj(entry) && typeof entry.item === 'string' && Array.isArray(entry.patterns)
      ? [{ item: entry.item, patterns: entry.patterns.filter((p) => typeof p === 'string') }]
      : [],
  )
}

// A pattern that is not a valid expression catches nothing here, so a draft is never refused over it.
const matches = (pattern: string, line: string) => {
  try {
    return new RegExp(pattern, 'i').test(line)
  } catch {
    return false
  }
}

const hits = (stack: unknown, cv: unknown): Hit[] => {
  const lines = strings(cv)
  return neverClaimsIn(stack).flatMap((claim) =>
    claim.patterns.flatMap((pattern) =>
      lines.filter((line) => matches(pattern, line)).map((line) => ({ ...claim, pattern, line })),
    ),
  )
}

const readIn = (root: string, rel: string, read: (text: string) => unknown): unknown => {
  const path = join(root, rel)
  if (!existsSync(path)) return undefined
  try {
    return read(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export const stackRefusals = (stack: unknown, root: string): string[] =>
  hits(stack, readIn(root, 'cv/master.json', JSON.parse)).map(
    (h) =>
      `never-claim pattern "${h.pattern}" (${h.item}) matches the CV's own line "${h.line}"; narrow it to catch only the claim`,
  )

export const masterRefusals = (cv: unknown, root: string): string[] =>
  hits(readIn(root, 'profile/stack.yaml', parse), cv).map(
    (h) =>
      `the line "${h.line}" is caught by never-claim pattern "${h.pattern}" (${h.item}) in profile/stack.yaml; narrow that pattern there, then draft this file again`,
  )
