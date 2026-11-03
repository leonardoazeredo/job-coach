// Drafts and writes the Profile files and the master CV, so the summary the user says yes to
// and the file written come from one source.
// Usage: node scripts/profile.ts draft <file> < input
//        node scripts/profile.ts write <file>...
//        node scripts/profile.ts drop <file>...
//        node scripts/profile.ts drafts
// draft reads the input on stdin: JSON values for a YAML or JSON file, the whole text for a
// markdown one. It prints the summary to relay, or "No change." and keeps no draft.
// write writes the named drafts unchanged, then runs the record check and puts the files
// back if the check finds an error the write brought in. It does not save.
// drafts lists the drafts waiting, with their age.
// Exit 64 on a usage error or a file no draft is made of, 65 when the input is not JSON values,
// 66 when a named file has no draft, 1 when a draft or write is refused or undone. Otherwise 0.
import { DRAFTABLE, makeDraft } from './lib/draft.ts'
import { dropDrafts, listDrafts, type Open, writeDrafts } from './lib/draft-store.ts'
import { EXIT, printProblems } from './lib/problem.ts'
import { openWorkspace, repoRoot } from './lib/workspace.ts'

const USAGE =
  'usage: node scripts/profile.ts draft <file> < input | write <file>... | drop <file>... | drafts'

export type ProfileDeps = { stdin?: () => Promise<string>; now?: Date; open?: Open }

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

// The visibility probe is for check.ts's own warning; the record check needs none.
const openQuiet: Open = (root) => openWorkspace(root, async () => undefined)

const UNITS: [string, number][] = [
  ['day', 24 * 60],
  ['hour', 60],
  ['minute', 1],
]

const ago = (made: Date, now: Date): string => {
  const minutes = Math.floor((now.getTime() - made.getTime()) / 60_000)
  for (const [unit, size] of UNITS) {
    const n = Math.floor(minutes / size)
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

const draft = async (file: string, root: string, deps: ProfileDeps, now: Date) => {
  const input = await (deps.stdin ?? readStdin)()
  const result = makeDraft(root, file, input, { open: deps.open ?? openQuiet, now })
  switch (result.kind) {
    case 'not-values':
      console.error(`${file}: the input could not be read as values: ${result.reason}`)
      return EXIT.data
    case 'refused':
      printProblems(result.problems, true)
      return EXIT.problems
    case 'unchanged':
      console.log('No change.')
      return 0
    case 'drafted':
      console.log(result.summary.join('\n'))
      return 0
  }
}

const write = (files: string[], root: string, open: Open) => {
  const result = writeDrafts(root, files, open)
  switch (result.kind) {
    case 'missing':
      printProblems(result.problems, true)
      return EXIT.missing
    case 'stale':
      printProblems(result.problems, true)
      return EXIT.problems
    case 'restored':
      console.log(
        `not written: the record check found problems, so ${files.join(', ')} stayed as before`,
      )
      printProblems(result.problems, true)
      return EXIT.problems
    case 'written':
      console.log(`written: ${result.files.join(', ')}`)
      return 0
  }
}

const drop = (files: string[], root: string) => {
  const problems = dropDrafts(root, files)
  printProblems(problems, true)
  if (problems.length > 0) return EXIT.missing
  console.log(`dropped: ${files.join(', ')}`)
  return 0
}

const drafts = (root: string, now: Date) => {
  const waiting = listDrafts(root)
  if (waiting.length === 0) console.log('No drafts are waiting.')
  for (const d of waiting) console.log(`${d.file}, made ${ago(d.made, now)}`)
  return 0
}

const usage = (message = USAGE) => {
  console.error(message)
  return EXIT.usage
}

export const profileCommand = async (
  args: string[],
  root: string,
  deps: ProfileDeps = {},
): Promise<number> => {
  const now = deps.now ?? new Date()
  const [sub, ...files] = args
  const unknown = files.filter((f) => !DRAFTABLE.includes(f))
  if (unknown.length > 0)
    return usage(
      `not a file a draft is made of: ${unknown.join(', ')}; one of ${DRAFTABLE.join(', ')}`,
    )
  const [file] = files
  if (sub === 'draft' && file !== undefined && files.length === 1)
    return draft(file, root, deps, now)
  if (sub === 'drafts') return files.length === 0 ? drafts(root, now) : usage()
  if (files.length === 0) return usage()
  if (sub === 'write') return write(files, root, deps.open ?? openQuiet)
  if (sub === 'drop') return drop(files, root)
  return usage()
}

if (import.meta.main) process.exitCode = await profileCommand(process.argv.slice(2), repoRoot())
