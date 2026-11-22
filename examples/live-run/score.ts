// Marks the checklist lines of a finished live run that a script can mark, so the judge spends
// its reading on the rest. It lives beside the run's scripts, not under scripts/, because it
// serves only the live-run harness; its test in scripts/__tests__ is what `npm run ci` runs.
// Usage: node examples/live-run/score.ts <run-dir>
// Prints one line per finding (`line 26 FAIL T15 "..."`), one `line N PASS` for each covered
// line without a finding (`SKIPPED` when the folder lacks what the line reads), and, for an
// onboarding run, the turn count. A sentence the one-framing rule lets through as a note a skill
// asks for gets an `EXCUSED` row naming the entry in notes.ts, so a reader can overrule it. A rule names its checklist line by the `[key]` after the
// line's number, read from the checklist when the scorer runs, so inserting a line cannot move a
// rule. A finding is a report, not an error: the exit code says only whether the folder could be
// scored (64 usage, 66 no run folder or transcript, 65 a rule's key missing from, or twice in,
// the run's checklist).
// Line 4 asks whether each summary line appears in the reply, so a merged or dropped duplicate
// line passes: a finding is a lead for the judge, not a verdict.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EXIT } from '../../scripts/lib/problem.ts'
import { repoRoot } from '../../scripts/lib/workspace.ts'
import { formatRow, type Row } from './findings.ts'
import { NOTES } from './notes.ts'
import { draftsIn, type RunKind, readTranscript, runKind } from './run-folder.ts'

const CHECKLIST_DIR = import.meta.dirname
export const CHECKLIST_FILE: Record<RunKind, string> = {
  onboarding: 'checklist.md',
  update: 'update-checklist.md',
}

const USAGE = 'usage: node examples/live-run/score.ts <run-dir>'

type Turn = { n: number; reply: string; summaries: string[]; winsDrafted: boolean }

// The summary lines are the command's wording, so they are compared as printed apart from
// spacing, emphasis marks and a list bullet the coach may add or drop.
const plain = (s: string) =>
  s
    .replace(/[*`]/g, '')
    .replace(/^\s*[-•]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

const readTurns = (run: string): Turn[] =>
  readTranscript(run).map(({ n, reply }) => {
    const path = join(run, 'raw', `turn${n}.jsonl`)
    const drafts = existsSync(path)
      ? draftsIn(readFileSync(path, 'utf8'))
      : { summaries: [], winsDrafted: false }
    return { n, reply, ...drafts }
  })

// What a reply says outside the lines it relays from a summary.
const outsideSummary = (t: Turn) => {
  const shown = t.summaries.map(plain)
  return t.reply
    .split('\n')
    .filter((l) => !shown.some((s) => s !== '' && plain(l).includes(s)))
    .join('\n')
}

const ORDINAL =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last) (?:one|achievement)\b/i
const PRONOUN = /\b(he|she|him|his|her|hers|himself|herself|they|them|their|theirs|themselves)\b/i
const WORKING_WORD = /\b(drafts?|files?)\b|\b[\w-]+\.(?:ya?ml|md|json|ts|txt)\b|the draft says/i
// The coach speaks to the person, so a sentence that calls them "the user" is a note to itself.
// "user name", "username" and "user-facing" are not a name for the person.
const NOTE_TO_SELF = /\bthe user\b(?!\s*-?\s*name\b|-facing)/i
// "skill" is the coach's working word only when a determiner joins it to load or run, with at
// most one word before a singular "skill" ("the update skill"), or when a skill's name comes
// before it; the person's own skills ("your skills", "run any skills") stay unmarked.
const SKILL_NAMES =
  'application-writer|company-research|correspondence|cv-for-role|cv-tailor|experience-mining|interview-debrief|interview-practice|interview-prep|job-intake|offer-review|onboarding|pipeline-board|pipeline-update|role-triage|take-home|update-coach'
const SKILL_WORD = new RegExp(
  `\\b(?:load|loads|loaded|loading|run|runs|running|ran)\\s+(?:the|a|an|this|that|its|each)\\s+(?:skills(?![\\w-])|(?:[\\w-]+\\s+)?skill(?![\\w-]))|\\b(?:${SKILL_NAMES})\\s+skill(?![\\w-])`,
  'i',
)
const workingNote = (s: string) => NOTE_TO_SELF.test(s) || SKILL_WORD.test(s)
const UPDATE_STEP =
  /\bI'll (?:load|run|use|read|check|start)\b|\bthe update steps\b|\bKeep both:|\bupstream\b/i

// Third-person pronouns belong in coach.md only; every other written file stays free of them.
const writtenFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? writtenFiles(p) : [p]
  })

type Found = { turn?: number; where?: string; text: string }
type Excused = { turn: number; text: string; by: string }
type Ctx = { run: string; turns: Turn[]; firstWins: number | undefined }

// One checklist line: the `[key]` that names it in the checklist (its number is found there, so
// it is never written here), the kinds of run it applies to, when its evidence is missing, and
// what it reports. A line with `find` gets a FAIL row per finding, or one PASS row when it has none, or a
// SKIPPED row when `skip` says the folder lacks what it reads; a line with `info` is a note, never
// a verdict. The printed rows follow from this table alone.
export type Rule = {
  key: string
  runs: RunKind[]
  skip?: (run: string) => string | undefined
  // Sentences the rule let through, shown beside its findings so a reader can overrule them.
  excused?: (c: Ctx) => Excused[]
} & ({ find: (c: Ctx) => Found[] } | { info: (c: Ctx) => string })

const perTurn = (c: Ctx, f: (t: Turn, c: Ctx) => Found[]): Found[] =>
  c.turns.flatMap((t) => f(t, c).map((x) => ({ turn: t.n, ...x })))

const noRaw = (run: string) => (existsSync(join(run, 'raw')) ? undefined : 'no raw/ folder')
const noWritten = (run: string) =>
  existsSync(join(run, 'written')) ? undefined : 'no written/ folder'

// What the coach says outside the lines it relays, one sentence at a time.
const outsideSentences = (t: Turn) => sentences(outsideSummary(t).replace(/\n/g, ' '))

// finish.sh copies every pack, shipped ones included; only a pack the coach wrote or changed counts.
const isShippedPack = (file: string, name: string) => {
  if (!name.startsWith(join('config', 'competencies'))) return false
  const shipped = join(repoRoot(), name)
  return existsSync(shipped) && readFileSync(shipped).equals(readFileSync(file))
}

const pronounsWritten = (run: string): Found[] => {
  const written = join(run, 'written')
  if (!existsSync(written)) return []
  return writtenFiles(written).flatMap((file) => {
    const name = relative(written, file)
    if (name === 'profile/coach.md' || isShippedPack(file, name)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, i) =>
        PRONOUN.test(text) ? [{ where: `${name}:${i + 1}`, text: text.trim() }] : [],
      )
  })
}

// The sentences outside the summary that are not a question, split into the notes a skill asks
// for (each entry excuses at most one) and the framing that is left. A sentence naming a working
// word is never excused: such a note is still a fault.
const framingSplit = (t: Turn) => {
  const open = [...NOTES]
  const excused: { text: string; by: string }[] = []
  const framing: string[] = []
  for (const s of sentences(plain(outsideSummary(t).replace(/\n/g, ' ')))) {
    if (s.endsWith('?')) continue
    const hit =
      WORKING_WORD.test(s) || workingNote(s) ? -1 : open.findIndex((e) => e.matches.test(s))
    if (hit < 0) framing.push(s)
    else excused.push({ text: s, by: (open.splice(hit, 1)[0] as (typeof NOTES)[number]).id })
  }
  return { framing, excused }
}

export const RULES: Rule[] = [
  {
    key: 'summary-whole',
    runs: ['onboarding'],
    skip: noRaw,
    find: (c) =>
      perTurn(c, (t) =>
        t.summaries
          .filter((s) => !plain(t.reply).includes(plain(s)))
          .map((s) => ({ text: plain(s) })),
      ),
  },
  {
    key: 'one-framing',
    runs: ['onboarding'],
    skip: noRaw,
    find: (c) =>
      perTurn(c, (t) => {
        // The question that asks for the yes is not framing.
        const { framing } = framingSplit(t)
        return t.summaries.length > 0 && framing.length > 1 ? framing.map((text) => ({ text })) : []
      }),
    excused: (c) =>
      c.turns.flatMap((t) =>
        t.summaries.length > 0 ? framingSplit(t).excused.map((e) => ({ turn: t.n, ...e })) : [],
      ),
  },
  {
    key: 'pronouns-in-coach-md',
    runs: ['onboarding'],
    skip: noWritten,
    find: (c) => pronounsWritten(c.run),
  },
  {
    key: 'working-words',
    runs: ['onboarding'],
    find: (c) =>
      perTurn(c, (t) =>
        outsideSentences(t)
          .filter((s) => WORKING_WORD.test(s) || workingNote(s))
          .map((s) => ({ text: plain(s) })),
      ),
  },
  {
    key: 'ordinal-names',
    runs: ['onboarding'],
    skip: noRaw,
    find: (c) =>
      perTurn(c, (t) =>
        c.firstWins !== undefined && t.n >= c.firstWins
          ? outsideSentences(t)
              .filter((s) => ORDINAL.test(s))
              .map((s) => ({ text: plain(s) }))
          : [],
      ),
  },
  { key: 'turn-count', runs: ['onboarding'], info: (c) => `${c.turns.length} turns` },
  {
    key: 'update-working-words',
    runs: ['update'],
    find: (c) =>
      perTurn(c, (t) =>
        sentences(t.reply.replace(/\n/g, ' '))
          .filter((s) => UPDATE_STEP.test(s) || workingNote(s))
          .map((s) => ({ text: plain(s) })),
      ),
  },
]

// A key that is missing or twice would put a row on the wrong line, so it stops the scorer.
export class ChecklistKeyError extends Error {}

// The line number of each key in a kind's checklist, for the keys of `rules` that apply to it.
export const checklistLines = (
  kind: RunKind,
  rules: Rule[] = RULES,
  dir = CHECKLIST_DIR,
): Map<string, number> => {
  const file = CHECKLIST_FILE[kind]
  const found = new Map<string, number[]>()
  for (const l of readFileSync(join(dir, file), 'utf8').split('\n')) {
    const m = /^(\d+)\.\s+\[([^\]]+)\]/.exec(l)
    if (m) found.set(m[2] as string, [...(found.get(m[2] as string) ?? []), Number(m[1])])
  }
  const at = new Map<string, number>()
  for (const r of rules.filter((x) => x.runs.includes(kind))) {
    const lines = found.get(r.key) ?? []
    if (lines.length === 0) throw new ChecklistKeyError(`"${r.key}" is not in ${file}`)
    if (lines.length > 1) throw new ChecklistKeyError(`"${r.key}" is in ${file} more than once`)
    at.set(r.key, lines[0] as number)
  }
  return at
}

// The rows of a run, ordered by line, then by turn; a row with no turn comes first in its line.
// `checklistDir` is for tests that bring their own checklists.
export const scoreFindings = (
  run: string,
  rules: Rule[] = RULES,
  checklistDir = CHECKLIST_DIR,
): Row[] => {
  const turns = readTurns(run)
  const kind = runKind(run)
  const at = checklistLines(kind, rules, checklistDir)
  const lineOf = (r: Rule) => at.get(r.key) as number
  const ctx: Ctx = { run, turns, firstWins: turns.find((t) => t.winsDrafted)?.n }
  const rows = rules
    .filter((r) => r.runs.includes(kind))
    .flatMap((r): Row[] => {
      if ('info' in r) return [{ line: lineOf(r), status: 'INFO', text: r.info(ctx) }]
      const found = r.find(ctx)
      const excused: Row[] = (r.excused?.(ctx) ?? []).map((e) => ({
        line: lineOf(r),
        status: 'EXCUSED',
        turn: e.turn,
        text: e.text,
        by: e.by,
      }))
      if (found.length > 0)
        return [...found.map((f): Row => ({ line: lineOf(r), status: 'FAIL', ...f })), ...excused]
      const why = r.skip?.(run)
      return [
        why === undefined
          ? { line: lineOf(r), status: 'PASS' }
          : { line: lineOf(r), status: 'SKIPPED', text: why },
        ...excused,
      ]
    })
  return rows.sort((a, b) => a.line - b.line || (a.turn ?? 0) - (b.turn ?? 0))
}

export const scoreRun = (run: string, rules: Rule[] = RULES, checklistDir?: string): string[] =>
  scoreFindings(run, rules, checklistDir).map(formatRow)

export const scoreCommand = (
  args: string[],
  rules: Rule[] = RULES,
  checklistDir?: string,
): number => {
  const [run, ...extra] = args
  if (run === undefined || extra.length > 0 || run.startsWith('--')) {
    console.error(USAGE)
    return EXIT.usage
  }
  if (!existsSync(run) || !statSync(run).isDirectory()) {
    console.error(`no run folder at ${run}`)
    return EXIT.missing
  }
  if (!existsSync(join(run, 'transcript.md'))) {
    console.error(`no transcript.md in ${run}; the run has not played a turn`)
    return EXIT.missing
  }
  try {
    console.log(scoreRun(run, rules, checklistDir).join('\n'))
  } catch (e) {
    if (!(e instanceof ChecklistKeyError)) throw e
    console.error(e.message)
    return EXIT.data
  }
  return 0
}

if (import.meta.main) process.exitCode = scoreCommand(process.argv.slice(2))
