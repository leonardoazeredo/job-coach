// The format of a live-run folder, in one place: what turn.sh records after a turn and what the
// scorer, the replay and the comment read back. A folder holds raw/turn<n>.jsonl (claude's stream),
// raw/reply<n>.txt (the persona's message), session.id, costlog.txt, last.txt, transcript.md and,
// from a run's start, kind. turn.sh calls the command line at the bottom for everything it
// records or reads here; no other shell script parses these files.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ---- the stream ----

type Event = {
  type?: string
  session_id?: unknown
  total_cost_usd?: unknown
  usage?: Record<string, unknown>
  message?: { content?: unknown }
}

// The claude command does not write `type` first, so a line is told apart by its parsed type. A
// line that is not JSON is counted and skipped, never fatal: one stray line must not discard a turn
// that was paid for.
const parseStream = (text: string): { events: Event[]; skipped: number } => {
  const events: Event[] = []
  let skipped = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const event = JSON.parse(line)
      if (event !== null && typeof event === 'object' && !Array.isArray(event)) events.push(event)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { events, skipped }
}

export type TurnStream = {
  // undefined when the stream holds no result with a session id.
  sessionId?: string | undefined
  // undefined when that result has no number for its cost.
  cost?: number | undefined
  // The coach's text of the turn, one entry per message.
  text: string[]
  cache: { read: number; written: number }
  skipped: number
}

// The turn's outcome is its last result event that carries a session id: the stream is a log, so a
// later result supersedes an earlier one.
export const readStream = (text: string): TurnStream => {
  const { events, skipped } = parseStream(text)
  const results = events.filter(
    (e) => e.type === 'result' && typeof e.session_id === 'string' && e.session_id !== '',
  )
  const last = results.at(-1)
  const n = (k: string) => (typeof last?.usage?.[k] === 'number' ? last.usage[k] : 0)
  const parts: string[] = []
  for (const e of events)
    if (e.type === 'assistant' && Array.isArray(e.message?.content))
      for (const c of e.message.content)
        if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text)
  return {
    sessionId: last === undefined ? undefined : String(last.session_id),
    cost: typeof last?.total_cost_usd === 'number' ? last.total_cost_usd : undefined,
    text: parts,
    cache: { read: n('cache_read_input_tokens'), written: n('cache_creation_input_tokens') },
    skipped,
  }
}

// The replay's summary line says how much of the prompt cache the samples read and wrote, summed,
// so a miss shows without opening the raw streams.
export const cacheSummary = (streams: string[]): string => {
  const sum = streams.map((s) => readStream(s).cache)
  const total = (k: 'read' | 'written') => sum.reduce((a, c) => a + c[k], 0)
  return `cache tokens read ${total('read')}, written ${total('written')}`
}

type Block = { type?: string; id?: string; tool_use_id?: string; is_error?: boolean } & Record<
  string,
  // biome-ignore lint/suspicious/noExplicitAny: a stream line is read for a few keys only
  any
>

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content.map((p: { text?: string }) => p.text ?? '').join('\n')
    : String(content ?? '')

// A turn's stream pairs each tool call with its result; the stdout of a `profile.ts draft` call is
// the summary the coach was to relay.
export const draftsIn = (text: string): { summaries: string[]; winsDrafted: boolean } => {
  let winsDrafted = false
  const files = new Map<string, string>()
  // A file drafted again in the same turn replaces its earlier summary: only the last one is shown.
  const latest = new Map<string, string[]>()
  const blocks: Block[] = parseStream(text).events.flatMap((e) =>
    Array.isArray(e.message?.content) ? e.message.content : [],
  )
  for (const block of blocks) {
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

// ---- the cost log and the session ----

export const costLine = (turn: number, total: number): string => `turn ${turn} ${total}\n`

const lines = (log: string) => log.split('\n').filter((l) => l.trim() !== '')

const totalOfLine = (line: string | undefined): number | undefined => {
  const total = line === undefined ? Number.NaN : Number(line.split(' ')[2])
  return Number.isFinite(total) ? total : undefined
}

// total_cost_usd is a running total for the session, so the last line is the spend: never sum it.
// A log with no usable line is 0.
export const runningTotal = (log: string): number => totalOfLine(lines(log).at(-1)) ?? 0

// The running total a turn left, from the last line for that turn; undefined when there is none.
export const totalAfter = (log: string, turn: number): number | undefined =>
  totalOfLine(
    lines(log)
      .filter((l) => l.startsWith(`turn ${turn} `))
      .at(-1),
  )

const readIf = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

export const readCostLog = (run: string): string => readIf(join(run, 'costlog.txt'))
export const readSession = (run: string): string => readIf(join(run, 'session.id'))

// ---- the transcript ----

// A block is the persona's message and the coach's reply, each quoted line by line.
const quoted = (text: string): string => {
  const rows = text === '' ? [] : text.replace(/\n$/, '').split('\n')
  return rows.map((l) => `> ${l}\n`).join('')
}

export const transcriptBlock = (turn: number, persona: string, coach: string): string =>
  `## Turn ${turn}\n\n**Persona:**\n\n${quoted(persona)}\n**Coach:**\n\n${quoted(coach)}\n`

const BLOCK_START = /^## Turn (\d+)\s*$/m

export type TranscriptTurn = { n: number; reply: string }

// The coach's reply of each turn, with the quoting taken off.
export const readTranscript = (run: string): TranscriptTurn[] => {
  const parts = readIf(join(run, 'transcript.md')).split(new RegExp(BLOCK_START.source, 'gm'))
  const turns: TranscriptTurn[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const coach = (parts[i + 1] ?? '').split('**Coach:**')[1] ?? ''
    const reply = coach
      .split('\n')
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n')
      .trim()
    turns.push({ n: Number(parts[i]), reply })
  }
  return turns
}

export const turnCount = (run: string): number =>
  (readIf(join(run, 'transcript.md')).match(/^## Turn \d+\s*$/gm) ?? []).length

// The blocks of the turns before `turn`, as written.
export const transcriptBefore = (run: string, turn: number): string =>
  readIf(join(run, 'transcript.md'))
    .split(/(?=^## Turn \d+\s*$)/m)
    .filter((b) => Number(BLOCK_START.exec(b)?.[1] ?? 0) < turn && BLOCK_START.test(b))
    .join('')

// ---- the kind of run ----

export type RunKind = 'onboarding' | 'update'

export const writeKind = (run: string, kind: RunKind): void =>
  writeFileSync(join(run, 'kind'), `${kind}\n`)

// A run says its kind from its start. A run made before that is told by what it holds: the engine
// an update run carries, or what finish-update.sh gathers.
export const runKind = (run: string): RunKind => {
  const named = readIf(join(run, 'kind')).trim()
  if (named === 'onboarding' || named === 'update') return named
  const holds = (...p: string[]) => existsSync(join(run, ...p))
  return holds('engine') || holds('written', 'log.txt') || holds('written', 'rules.yaml')
    ? 'update'
    : 'onboarding'
}

// ---- recording a turn ----

export type Recorded = { note?: string } | { failure: string }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

// What turn.sh keeps after claude ran turn `n`, read from raw/turn<n>.jsonl: the session, the cost
// line, the coach's text, the persona's message and the transcript block. A turn with no result
// records nothing, so the last cost line stays the running total and a retry of the turn leaves one
// block in the transcript.
export const recordTurn = (run: string, n: number, replyFile: string): Recorded => {
  const stream = join(run, 'raw', `turn${n}.jsonl`)
  const read = readStream(readIf(stream))
  if (read.sessionId === undefined)
    return {
      failure: `turn ${n} left no result; ${join(run, 'raw', `turn${n}.err`)} and ${stream} hold why`,
    }
  const notes: string[] = []
  if (read.skipped > 0)
    notes.push(
      `raw/turn${n}.jsonl: skipped ${plural(read.skipped, 'line')} that ${read.skipped === 1 ? 'is' : 'are'} not JSON`,
    )
  let cost = read.cost
  if (cost === undefined) {
    cost = runningTotal(readCostLog(run))
    notes.push(`raw/turn${n}.jsonl: the result has no total_cost_usd; the cost log keeps ${cost}`)
  }
  const persona = readFileSync(replyFile, 'utf8')
  const coach = read.text.join('\n\n')
  writeFileSync(join(run, 'session.id'), read.sessionId)
  appendFileSync(join(run, 'costlog.txt'), costLine(n, cost))
  writeFileSync(join(run, 'last.txt'), coach)
  writeFileSync(join(run, 'raw', `reply${n}.txt`), persona)
  appendFileSync(join(run, 'transcript.md'), transcriptBlock(n, persona, coach))
  return notes.length === 0 ? {} : { note: notes.join('\n') }
}

// ---- the command line turn.sh and the finish scripts call ----

const USAGE = `usage: node run-folder.ts record <run> <n> <reply-file> | total <run> | session <run> | turns <run>`

export const runFolderCommand = (args: string[]): number => {
  const [verb, run, n, replyFile] = args
  if (run === undefined) {
    console.error(USAGE)
    return 64
  }
  if (verb === 'total') console.log(runningTotal(readCostLog(run)))
  else if (verb === 'session') process.stdout.write(readSession(run))
  else if (verb === 'turns') console.log(turnCount(run))
  else if (verb === 'record' && n !== undefined && replyFile !== undefined) {
    const r = recordTurn(run, Number(n), replyFile)
    if ('failure' in r) {
      console.log(r.failure)
      return 2
    }
    if (r.note) console.log(r.note)
  } else {
    console.error(USAGE)
    return 64
  }
  return 0
}

if (import.meta.main) process.exitCode = runFolderCommand(process.argv.slice(2))
