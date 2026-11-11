// The argument reading the two hand-run entry points share. It returns a usage problem
// instead of exiting, so the entry points stay functions from arguments to an exit code.

export type ArgSpec = {
  // Flags that take one value, looked up in this order.
  flags: string[]
  // A bare `--` ends option parsing: everything after it is a file name.
  endMarker?: boolean
  // Refuse `--flag=value` for a listed flag, where the entry point asks for `--flag value`.
  rejectEquals?: boolean
}

export type UsageProblem =
  | { kind: 'needs-value'; flag: string }
  | { kind: 'equals-form'; flag: string }

export type ParsedArgs = {
  values: Record<string, string | undefined>
  // Whatever no flag took, in order; may hold an unknown `--option`. The entry point decides
  // what an unknown option and a missing required flag say.
  rest: string[]
  // Everything after the end marker; empty without one.
  afterEnd: string[]
}

export const parseArgs = (
  argv: string[],
  spec: ArgSpec,
): ParsedArgs | { problem: UsageProblem } => {
  const endAt = spec.endMarker ? argv.indexOf('--') : -1
  const rest = endAt === -1 ? [...argv] : argv.slice(0, endAt)
  const afterEnd = endAt === -1 ? [] : argv.slice(endAt + 1)

  if (spec.rejectEquals) {
    for (const flag of spec.flags) {
      if (rest.some((a) => a.startsWith(`${flag}=`))) {
        return { problem: { kind: 'equals-form', flag } }
      }
    }
  }
  const values: Record<string, string | undefined> = {}
  for (const flag of spec.flags) {
    const at = rest.indexOf(flag)
    if (at === -1) continue
    const value = rest[at + 1]
    if (!value || value.startsWith('--')) return { problem: { kind: 'needs-value', flag } }
    rest.splice(at, 2)
    values[flag] = value
  }
  return { values, rest, afterEnd }
}
