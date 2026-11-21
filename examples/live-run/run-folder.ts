// The format of a live-run folder, in one place: what turn.sh records after a turn and what the
// scorer, the replay and the comment read back. A folder holds raw/turn<n>.jsonl (claude's stream),
// raw/reply<n>.txt (the persona's message), session.id, costlog.txt, last.txt, transcript.md and,
// from a run's start, kind; snap/before<n>.tgz is what a replay of turn n starts from, and cost.txt
// marks a run finished. This module also takes the snapshot before a turn, says whether a replay
// has what it needs, lays out a replay sample's folder from a snapshot and trims it afterwards, and writes and reads a
// finished run's cost. turn.sh and the finish scripts call the command line at the bottom for
// everything they record or read here; no other shell script parses these files.
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../../scripts/lib/problem.ts'

// The folders of a run. start.sh and start-update.sh create all but snap by these names in shell,
// and up.sh mounts most of them, so a rename has to reach those scripts too; snap is made here.
export const LAYOUT = {
  copy: 'copy',
  raw: 'raw',
  claudehome: 'claudehome',
  cachehome: 'cachehome',
  tmpd: 'tmpd',
  snap: 'snap',
} as const

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
  // The coach's text of the turn, one entry per text block.
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
// A log with no lines, or whose last line has no usable total, is 0.
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

// The running total a run had after `turn`; 0 when the log has no line for it.
export const costAfter = (run: string, turn: number): number =>
  totalAfter(readCostLog(run), turn) ?? 0

// ---- the transcript ----

// Each line of a text gets the "> " prefix, and the text keeps its own ending: a trailing newline
// stays one and a missing one stays missing, as with `sed 's/^/> /'`.
const quoted = (text: string): string =>
  text === ''
    ? ''
    : text
        .split('\n')
        .map((l, i, all) => (i === all.length - 1 && l === '' ? '' : `> ${l}`))
        .join('\n')

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
  const stream = join(run, LAYOUT.raw, `turn${n}.jsonl`)
  const read = readStream(readIf(stream))
  if (read.sessionId === undefined)
    return {
      failure: `turn ${n} left no result; ${join(run, LAYOUT.raw, `turn${n}.err`)} and ${stream} hold why`,
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
  writeFileSync(join(run, LAYOUT.raw, `reply${n}.txt`), persona)
  appendFileSync(join(run, 'transcript.md'), transcriptBlock(n, persona, coach))
  return notes.length === 0 ? {} : { note: notes.join('\n') }
}

// ---- the snapshot and the replay ----

// What a replay of turn `n` starts from, taken before the turn: the copy without its installed
// packages, which are large and come back with npm ci, and the coach's session, which lives in
// claudehome. The .packages marker says whether npm ci is needed, so it is reset on every call, as
// a stale one would make a replay install packages the snapshot never had. A failed tar leaves a
// partial archive that missingForReplay would accept, so it is removed and no marker is set: a
// failure leaves neither. Returns why the snapshot failed, or undefined.
export const snapshot = (run: string, n: number): string | undefined => {
  const { copy, claudehome, snap } = LAYOUT
  mkdirSync(join(run, snap), { recursive: true })
  const tar = spawnSync(
    'tar',
    [
      '-czf',
      join(run, snap, `before${n}.tgz`),
      '-C',
      run,
      `--exclude=${copy}/node_modules`,
      copy,
      claudehome,
    ],
    { encoding: 'utf8' },
  )
  if (tar.status !== 0) rmSync(join(run, snap, `before${n}.tgz`), { force: true })
  const marker = join(run, snap, `before${n}.packages`)
  rmSync(marker, { force: true })
  if (tar.status === 0 && existsSync(join(run, copy, 'node_modules'))) writeFileSync(marker, '')
  return tar.status === 0 ? undefined : `could not snapshot before turn ${n}: ${tar.stderr.trim()}`
}

// Whether the copy had installed packages when the snapshot was taken, so a replay sample of the
// turn needs npm ci before it runs.
export const snapshotHadPackages = (run: string, n: number): boolean =>
  existsSync(join(run, LAYOUT.snap, `before${n}.packages`))

// What a replay of the turn needs from the run folder, or what is missing.
export const missingForReplay = (run: string, turn: number): string[] =>
  [`snap/before${turn}.tgz`, `raw/reply${turn}.txt`, `raw/turn${turn}.jsonl`, 'costlog.txt']
    .concat(turn > 1 ? [`raw/turn${turn - 1}.jsonl`] : [])
    .filter((f) => !existsSync(join(run, f)))

// The session id a turn ended with is in the result of its raw stream.
export const sessionAfter = (run: string, turn: number): string => {
  const id = readStream(readFileSync(join(run, LAYOUT.raw, `turn${turn}.jsonl`), 'utf8')).sessionId
  if (id === undefined) throw new Error(`raw/turn${turn}.jsonl holds no result with a session id`)
  return id
}

// A replay sample has a run folder's shape, so turn.sh and the scorer work on it unchanged: the
// snapshot unpacked, the transcript and raw streams up to the turn (which is how the scorer knows
// what came earlier), the persona's message as reply.txt and, after turn 1, the session and the
// one cost line a resumed turn starts from. Reads `run`, writes only `sample`.
export const prepareReplaySample = (run: string, turn: number, sample: string): void => {
  const { raw, snap, cachehome, tmpd } = LAYOUT
  mkdirSync(sample, { recursive: true })
  const tar = spawnSync('tar', ['-xzf', join(run, snap, `before${turn}.tgz`), '-C', sample], {
    encoding: 'utf8',
  })
  if (tar.status !== 0) throw new Error(`could not unpack the snapshot: ${tar.stderr}`)
  for (const d of [raw, cachehome, tmpd]) mkdirSync(join(sample, d), { recursive: true })
  if (existsSync(join(run, 'engine')))
    cpSync(join(run, 'engine'), join(sample, 'engine'), { recursive: true })
  writeKind(sample, runKind(run))
  writeFileSync(join(sample, 'transcript.md'), transcriptBefore(run, turn))
  for (let k = 1; k < turn; k++)
    if (existsSync(join(run, raw, `turn${k}.jsonl`)))
      cpSync(join(run, raw, `turn${k}.jsonl`), join(sample, raw, `turn${k}.jsonl`))
  cpSync(join(run, raw, `reply${turn}.txt`), join(sample, 'reply.txt'))
  if (turn > 1) {
    writeFileSync(join(sample, 'session.id'), sessionAfter(run, turn - 1))
    // Only the line for the turn before: the sample's own turn.sh adds the replayed turn's line.
    writeFileSync(join(sample, 'costlog.txt'), costLine(turn - 1, costAfter(run, turn - 1)))
  }
}

// What a replay sample keeps once its turn is done or has failed: what the scorer, a rescore and a
// reader open (the stream, the replies, the cost log, the transcript, the kind and the copy for the
// drafts' paths). The rest was only there to run the turn: the snapshot, the coach's session and
// caches, the engine an update run reads, and the installed packages, which are most of a sample.
export const trimReplaySample = (sample: string): void => {
  const { copy, claudehome, cachehome, tmpd, snap } = LAYOUT
  for (const gone of [snap, claudehome, cachehome, tmpd, 'engine', join(copy, 'node_modules')])
    rmSync(join(sample, gone), { recursive: true, force: true })
}

// ---- a finished run's cost ----

// cost.txt is what tells comment.ts a run is finished. total_cost_usd is already a running total,
// so the file holds the cost log's last total and is never a sum.
export const writeCost = (run: string): string => {
  const line = `total_usd ${runningTotal(readCostLog(run))}\n`
  writeFileSync(join(run, 'cost.txt'), line)
  return line
}

// The cost as a number, or as read when the file holds something else; a stray backtick is dropped
// because the comment prints it in a code span.
export const readCost = (run: string): number | string => {
  const raw = readFileSync(join(run, 'cost.txt'), 'utf8')
    .trim()
    .replace(/^total_usd(\s+|$)/, '')
    .replace(/`/g, '')
  return Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw
}

// ---- the command line turn.sh and the finish scripts call ----

const USAGE = `usage: node run-folder.ts record <run> <n> <reply-file> | snapshot <run> <n> | total <run> | session <run> | turns <run> | cost <run>`

const snapshotCommand = (run: string, n: number): number => {
  const failure = snapshot(run, n)
  if (failure === undefined) return 0
  console.error(failure)
  return EXIT.data
}

// A cost log that exists but cannot be read stops here with nothing written, so cost.txt never
// holds a 0 the log did not give; a missing log is a real 0, as for the running total.
const costCommand = (run: string): number => {
  try {
    process.stdout.write(writeCost(run))
    return 0
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).split('\n')[0]
    console.error(`could not write cost.txt in ${run}: ${why}`)
    return EXIT.data
  }
}

const recordCommand = (run: string, n: number, replyFile: string): number => {
  const r = recordTurn(run, n, replyFile)
  if ('failure' in r) {
    console.log(r.failure)
    return EXIT.data
  }
  if (r.note) console.log(r.note)
  return 0
}

export const runFolderCommand = (args: string[]): number => {
  const [verb, run, n, replyFile] = args
  if (run === undefined) {
    console.error(USAGE)
    return EXIT.usage
  }
  if (verb === 'total') console.log(runningTotal(readCostLog(run)))
  else if (verb === 'session') console.log(readSession(run))
  else if (verb === 'turns') console.log(turnCount(run))
  else if (verb === 'cost') return costCommand(run)
  else if (verb === 'snapshot' && n !== undefined) return snapshotCommand(run, Number(n))
  else if (verb === 'record' && n !== undefined && replyFile !== undefined)
    return recordCommand(run, Number(n), replyFile)
  else {
    console.error(USAGE)
    return EXIT.usage
  }
  return 0
}

if (import.meta.main) process.exitCode = runFolderCommand(process.argv.slice(2))
