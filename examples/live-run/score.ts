// Marks the checklist lines of a finished live run that a script can mark, so the judge spends
// its reading on the rest. It lives beside the run's scripts, not under scripts/, because it
// serves only the live-run harness; its test in scripts/__tests__ is what `npm run ci` runs.
// Usage: node examples/live-run/score.ts <run-dir>
// Prints one line per finding (`line 26 FAIL T15 "..."`), one `line N PASS` for each covered
// line without a finding (`SKIPPED` when the folder lacks what the line reads), and, for an
// onboarding run, the turn count. A finding is a report, not an error: the exit code says only
// whether the folder could be scored (64 usage, 66 no run folder or transcript).
// Line 4 asks whether each summary line appears in the reply, so a merged or dropped duplicate
// line passes: a finding is a lead for the judge, not a verdict.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EXIT } from '../../scripts/lib/problem.ts'
import { repoRoot } from '../../scripts/lib/workspace.ts'

const USAGE = 'usage: node examples/live-run/score.ts <run-dir>'

type Turn = { n: number; reply: string; summaries: string[]; winsDrafted: boolean }
type Finding = { line: number; turn?: number; where?: string; text: string }

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

const readTurns = (run: string): Turn[] => {
  const blocks = readFileSync(join(run, 'transcript.md'), 'utf8').split(/^## Turn (\d+)\s*$/m)
  const turns: Turn[] = []
  for (let i = 1; i < blocks.length; i += 2) {
    const n = Number(blocks[i])
    const coach = (blocks[i + 1] ?? '').split('**Coach:**')[1] ?? ''
    const reply = coach
      .split('\n')
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n')
      .trim()
    turns.push({ n, reply, ...readDrafts(run, n) })
  }
  return turns
}

type Block = { type?: string; id?: string; tool_use_id?: string; is_error?: boolean } & Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: a stream line is read for a few keys only
  any
>

const blocksOf = (raw: string): Block[] => {
  try {
    const content = JSON.parse(raw)?.message?.content
    return Array.isArray(content) ? content : []
  } catch {
    return []
  }
}

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map((p: { text?: string }) => p.text ?? '').join('\n')
    : String(content ?? '')

// A turn's raw stream pairs each tool call with its result; a draft's stdout is the summary.
const readDrafts = (run: string, n: number) => {
  const path = join(run, 'raw', `turn${n}.jsonl`)
  let winsDrafted = false
  if (!existsSync(path)) return { summaries: [], winsDrafted }
  const files = new Map<string, string>()
  // A file drafted again in the same turn replaces its earlier summary: only the last one is shown.
  const latest = new Map<string, string[]>()
  for (const block of readFileSync(path, 'utf8').split('\n').flatMap(blocksOf)) {
    const file = /profile\.ts\s+draft\s+(\S+)/.exec(String(block.input?.command ?? ''))?.[1]
    if (block.type === 'tool_use' && block.id && file) files.set(block.id, file)
    const drafted = files.get(block.tool_use_id ?? '')
    if (block.type !== 'tool_result' || drafted === undefined || block.is_error) continue
    const out = textOf(block.content).trim()
    if (out === '' || out === 'No change.') continue
    latest.set(
      drafted,
      out.split('\n').filter((l) => l.trim() !== ''),
    )
    winsDrafted ||= /wins\.yaml$/.test(drafted)
  }
  return { summaries: [...latest.values()].flat(), winsDrafted }
}

// What a reply says outside the lines it relays from a summary.
const outsideSummary = (t: Turn) => {
  const shown = t.summaries.map(plain)
  return t.reply
    .split('\n')
    .filter((l) => !shown.some((s) => s !== '' && plain(l).includes(s)))
    .join('\n')
}

const ORDINAL = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last) one\b/i
const PRONOUN = /\b(he|she|him|his|her|hers|himself|herself|they|them|their|theirs|themselves)\b/i
const WORKING_WORD = /\b(drafts?|files?)\b|\b[\w-]+\.(?:ya?ml|md|json|ts|txt)\b|the draft says/i
const NOTE_TO_SELF = /\bThe user said\b/
const UPDATE_STEP =
  /\bI'll (?:load|run|use|read|check|start)\b|\bthe update steps\b|\bKeep both:|\bupstream\b/i

// Third-person pronouns belong in coach.md only; every other written file stays free of them.
const writtenFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? writtenFiles(p) : [p]
  })

const scoreTurn = (t: Turn, firstWins: number | undefined): Finding[] => {
  const found: Finding[] = []
  for (const s of t.summaries) {
    if (!plain(t.reply).includes(plain(s))) found.push({ line: 4, turn: t.n, text: plain(s) })
  }
  const outside = outsideSummary(t).replace(/\n/g, ' ')
  // The question that asks for the yes is not framing.
  const framing = sentences(plain(outside)).filter((s) => !s.endsWith('?'))
  if (t.summaries.length > 0 && framing.length > 1) {
    for (const s of framing) found.push({ line: 5, turn: t.n, text: s })
  }
  const ordinalsApply = firstWins !== undefined && t.n >= firstWins
  for (const s of sentences(outside)) {
    if (WORKING_WORD.test(s) || NOTE_TO_SELF.test(s))
      found.push({ line: 26, turn: t.n, text: plain(s) })
    if (ordinalsApply && ORDINAL.test(s)) found.push({ line: 28, turn: t.n, text: plain(s) })
  }
  return found
}

// finish.sh copies every pack, shipped ones included; only a pack the coach wrote or changed counts.
const isShippedPack = (file: string, name: string) => {
  if (!name.startsWith(join('config', 'competencies'))) return false
  const shipped = join(repoRoot(), name)
  return existsSync(shipped) && readFileSync(shipped).equals(readFileSync(file))
}

const scorePronouns = (written: string): Finding[] =>
  writtenFiles(written).flatMap((file) => {
    const name = relative(written, file)
    if (name === 'profile/coach.md' || isShippedPack(file, name)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, i) =>
        PRONOUN.test(text) ? [{ line: 18, where: `${name}:${i + 1}`, text: text.trim() }] : [],
      )
  })

const scoreOnboarding = (run: string, turns: Turn[]): Finding[] => {
  const firstWins = turns.find((t) => t.winsDrafted)?.n
  const written = join(run, 'written')
  return [
    ...turns.flatMap((t) => scoreTurn(t, firstWins)),
    ...(existsSync(written) ? scorePronouns(written) : []),
  ]
}

const scoreUpdate = (turns: Turn[]): Finding[] => {
  const found: Finding[] = []
  for (const t of turns) {
    for (const s of sentences(t.reply.replace(/\n/g, ' '))) {
      if (UPDATE_STEP.test(s) || NOTE_TO_SELF.test(s))
        found.push({ line: 13, turn: t.n, text: plain(s) })
    }
  }
  return found
}

const isUpdateRun = (run: string) =>
  existsSync(join(run, 'written', 'log.txt')) || existsSync(join(run, 'written', 'rules.yaml'))

// A line whose evidence is missing is not a pass.
const skippedLines = (run: string) => {
  const skipped = new Map<number, string>()
  if (!existsSync(join(run, 'raw')))
    for (const l of [4, 5, 28]) skipped.set(l, 'SKIPPED no raw/ folder')
  if (!existsSync(join(run, 'written'))) skipped.set(18, 'SKIPPED no written/ folder')
  return skipped
}

export const scoreRun = (run: string): string[] => {
  const turns = readTurns(run)
  const update = isUpdateRun(run)
  const found = update ? scoreUpdate(turns) : scoreOnboarding(run, turns)
  const covered = update ? [13] : [4, 5, 18, 26, 28]
  const skipped = update ? new Map<number, string>() : skippedLines(run)
  const lines = [
    ...found.map((f) => ({
      line: f.line,
      turn: f.turn ?? 0,
      out: `line ${f.line} FAIL ${f.turn === undefined ? f.where : `T${f.turn}`} "${f.text}"`,
    })),
    ...covered
      .filter((l) => !found.some((f) => f.line === l))
      .map((l) => ({ line: l, turn: 0, out: `line ${l} ${skipped.get(l) ?? 'PASS'}` })),
  ]
  if (!update) lines.push({ line: 36, turn: 0, out: `line 36 INFO ${turns.length} turns` })
  return lines.sort((a, b) => a.line - b.line || a.turn - b.turn).map((l) => l.out)
}

export const scoreCommand = (args: string[]): number => {
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
  console.log(scoreRun(run).join('\n'))
  return 0
}

if (import.meta.main) process.exitCode = scoreCommand(process.argv.slice(2))
