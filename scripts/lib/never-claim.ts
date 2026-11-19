// A never-claim pattern in profile/stack.yaml that matches a true line of cv/master.json would
// fail every CV built for a role (cv-lint checks the built text against the patterns), so the
// two files must not disagree. Whichever is drafted second is refused. The refusal names the
// pattern and the line, so the coach narrows the pattern to the claim itself. What a pattern
// is, whether it is valid and what it catches is the stack module's.
import { join } from 'node:path'
import { CvDataSchema } from './cv-schema.ts'
import { readFile, yaml } from './read-file.ts'
import { neverClaimsIn, StackFileSchema } from './stack.ts'

// Every string in the CV, which is every line a pattern may catch.
const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  return typeof value === 'object' && value !== null ? Object.values(value).flatMap(strings) : []
}

// A refused invalid pattern is worded by the stack module and passed on unchanged.
export const stackRefusals = (now: Record<string, unknown>, root: string): string[] => {
  const guards = neverClaimsIn(now.do_not_claim)
  const master = readFile(join(root, 'cv/master.json'), (t) => CvDataSchema.parse(JSON.parse(t)))
  const lines = master.data ? strings(master.data) : []
  return [
    ...guards.invalid,
    ...lines.flatMap((line) =>
      guards
        .catches(line)
        .map(
          (c) =>
            `never-claim pattern "${c.pattern}" (${c.item}) matches the CV's own line "${line}"; narrow it to catch only the claim`,
        ),
    ),
  ]
}

// An invalid pattern already on file is the record check's to report, not this file's.
export const masterRefusals = (cv: Record<string, unknown>, root: string): string[] => {
  const stack = readFile(join(root, 'profile/stack.yaml'), yaml(StackFileSchema))
  if (!stack.data) return []
  const guards = neverClaimsIn(stack.data.do_not_claim)
  return strings(cv).flatMap((line) =>
    guards
      .catches(line)
      .map(
        (c) =>
          `the line "${line}" is caught by never-claim pattern "${c.pattern}" (${c.item}) in profile/stack.yaml; narrow that pattern there, then draft this file again`,
      ),
  )
}
