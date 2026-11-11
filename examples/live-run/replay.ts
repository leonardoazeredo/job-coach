// Replays one turn of a saved live run several times, to test a wording change aimed at that turn
// without a whole run. Each sample starts from the run's state before the turn (the snapshot
// turn.sh took: the copy and the coach's session), with this checkout's CLAUDE.md and skills put
// in, sends the persona's original message for that turn, and is marked by scoreRun. The run
// folder is only read; samples live in a new folder under the system's temporary folder.
// Usage: node examples/live-run/replay.ts <run-dir> <turn> [n]
// Needs Docker and CLAUDE_CODE_OAUTH_TOKEN in the environment: the token goes to each sample's
// container through up.sh and is never printed. The stop (LIVE_RUN_BUDGET_USD, default 5) applies
// to the sum of the samples' spend.
// Exit codes: 64 usage, 66 the run folder lacks what a replay of that turn needs.
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { EXIT } from '../../scripts/lib/problem.ts'
import { repoRoot } from '../../scripts/lib/workspace.ts'
import { scoreRun } from './score.ts'

const USAGE = 'usage: node examples/live-run/replay.ts <run-dir> <turn> [n]'
const HERE = import.meta.dirname

export type ReplayArgs = { run: string; turn: number; n: number }

const wholeNumber = (s: string) => /^[1-9]\d*$/.test(s)

export const parseReplayArgs = (args: string[]): ReplayArgs | string => {
  const [run, turn, n, ...extra] = args
  if (run === undefined || turn === undefined || extra.length > 0 || run.startsWith('--'))
    return USAGE
  if (!wholeNumber(turn)) return `the turn must be a whole number from 1: "${turn}"\n${USAGE}`
  if (n !== undefined && !wholeNumber(n))
    return `the count must be a whole number from 1: "${n}"\n${USAGE}`
  return { run, turn: Number(turn), n: n === undefined ? 5 : Number(n) }
}

// What a replay of the turn needs from the run folder, or what is missing.
export const missingForReplay = (run: string, turn: number): string[] =>
  [`snap/before${turn}.tgz`, `raw/reply${turn}.txt`, `raw/turn${turn}.jsonl`, 'costlog.txt']
    .concat(turn > 1 ? [`raw/turn${turn - 1}.jsonl`] : [])
    .filter((f) => !existsSync(join(run, f)))

// The line a scorer finding is about, its verdict, and the turn it names (none for a finding about
// a written file or the turn count).
const VERDICT = /^line (\d+) (FAIL|PASS|SKIPPED|INFO)(?: T(\d+))?/

// The fail rate of every line the scorer marked at the replayed turn, from each sample's scorer
// output. A line counts when a sample shows it passed, or failed at some turn; it fails a sample
// when it failed at the replayed turn. Findings at earlier turns, which every sample shares, and
// lines about written files are left out.
export const failRates = (
  turn: number,
  scored: string[][],
): { line: number; fails: number; samples: number }[] => {
  const marked = new Set<number>()
  const failed = scored.map(() => new Set<number>())
  scored.forEach((out, i) => {
    for (const l of out) {
      const m = VERDICT.exec(l)
      if (!m) continue
      const line = Number(m[1])
      if (m[2] === 'PASS' || (m[2] === 'FAIL' && m[3] !== undefined)) marked.add(line)
      if (m[2] === 'FAIL' && Number(m[3]) === turn) failed[i]?.add(line)
    }
  })
  return [...marked]
    .sort((a, b) => a - b)
    .map((line) => ({
      line,
      fails: failed.filter((f) => f.has(line)).length,
      samples: scored.length,
    }))
}

export const formatRates = (rates: ReturnType<typeof failRates>): string =>
  rates
    .map(
      (r) =>
        `line ${r.line}: ${r.fails} of ${r.samples} replies failed (${Math.round((100 * r.fails) / r.samples)}%)`,
    )
    .join('\n')

const sh = (cmd: string, args: string[], cwd?: string) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8' })

// The session id a turn ended with is in the result line of its raw stream.
const sessionAfter = (run: string, turn: number): string => {
  for (const line of readFileSync(join(run, 'raw', `turn${turn}.jsonl`), 'utf8').split('\n')) {
    if (!line.startsWith('{"type":"result"')) continue
    const id = JSON.parse(line).session_id
    if (typeof id === 'string' && id !== '') return id
  }
  throw new Error(`raw/turn${turn}.jsonl holds no result with a session id`)
}

// The cost line a turn left in costlog.txt is the session's running total.
const costAfter = (run: string, turn: number): number => {
  const line = readFileSync(join(run, 'costlog.txt'), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`turn ${turn} `))
  return line === undefined ? 0 : Number(line.split(' ')[2])
}

// This checkout's CLAUDE.md and skills go into the sample's copy and are committed there, as
// start.sh's copy of a commit has them, dated like the copy's last commit so the order of a
// history the coach reads does not change.
const applyTree = (copy: string, root: string) => {
  cpSync(join(root, 'CLAUDE.md'), join(copy, 'CLAUDE.md'))
  rmSync(join(copy, '.claude', 'skills'), { recursive: true, force: true })
  cpSync(join(root, '.claude', 'skills'), join(copy, '.claude', 'skills'), { recursive: true })
  const git = (...a: string[]) => sh('git', ['-C', copy, ...a])
  if (git('status', '--short', '--', 'CLAUDE.md', '.claude/skills').stdout.trim() === '') return
  const date = git('log', '-1', '--format=%cI').stdout.trim()
  git('add', '--', 'CLAUDE.md', '.claude/skills')
  spawnSync(
    'git',
    [
      '-C',
      copy,
      '-c',
      'user.name=Persona',
      '-c',
      'user.email=persona@example.com',
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'Wording of the coach under test',
    ],
    { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } },
  )
}

// A sample folder has a run folder's shape, so turn.sh and scoreRun work on it unchanged. It
// holds the run's transcript and raw streams up to the turn, which is how the scorer knows what
// came earlier. Reads the run folder and root; writes only the sample.
export const prepareSample = (run: string, turn: number, sample: string, root: string) => {
  mkdirSync(sample, { recursive: true })
  const tar = sh('tar', ['-xzf', join(run, 'snap', `before${turn}.tgz`), '-C', sample])
  if (tar.status !== 0) throw new Error(`could not unpack the snapshot: ${tar.stderr}`)
  for (const d of ['raw', 'cachehome', 'tmpd']) mkdirSync(join(sample, d), { recursive: true })
  if (existsSync(join(run, 'engine'))) {
    cpSync(join(run, 'engine'), join(sample, 'engine'), { recursive: true })
    // The scorer reads a run with a log as an update run.
    mkdirSync(join(sample, 'written'))
    writeFileSync(join(sample, 'written', 'log.txt'), '')
  }
  const blocks = readFileSync(join(run, 'transcript.md'), 'utf8').split(/(?=^## Turn \d+$)/m)
  const before = (b: string) => Number(/^## Turn (\d+)$/m.exec(b)?.[1] ?? 0) < turn
  writeFileSync(join(sample, 'transcript.md'), blocks.filter(before).join(''))
  for (let k = 1; k < turn; k++)
    if (existsSync(join(run, 'raw', `turn${k}.jsonl`)))
      cpSync(join(run, 'raw', `turn${k}.jsonl`), join(sample, 'raw', `turn${k}.jsonl`))
  cpSync(join(run, 'raw', `reply${turn}.txt`), join(sample, 'reply.txt'))
  if (turn > 1) {
    writeFileSync(join(sample, 'session.id'), sessionAfter(run, turn - 1))
    writeFileSync(join(sample, 'costlog.txt'), `turn ${turn - 1} ${costAfter(run, turn - 1)}\n`)
  }
  applyTree(join(sample, 'copy'), root)
  sh('chmod', ['-R', 'a+rwX', sample])
}

const stamp = () => `[${new Date().toTimeString().slice(0, 8)}]`

const runSample = (run: string, turn: number, sample: string, hasPackages: boolean): number => {
  const container = `coach-live-run-${basename(sample)}`
  const up = spawnSync(join(HERE, 'up.sh'), [sample], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (up.status !== 0) throw new Error('the sample container did not start')
  try {
    if (hasPackages) {
      console.log(`${stamp()} installing the coach's packages (about 20 s)`)
      sh('docker', ['exec', container, 'npm', 'ci', '--silent'])
    }
    const base = turn > 1 ? costAfter(run, turn - 1) : 0
    const t = spawnSync(join(HERE, 'turn.sh'), [sample, String(turn), join(sample, 'reply.txt')], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    if (t.status !== 0) throw new Error(`turn.sh failed (exit ${t.status}); see ${sample}/raw`)
    return costAfter(sample, turn) - base
  } finally {
    sh('docker', ['rm', '-f', container])
  }
}

export const replayCommand = (args: string[]): number => {
  const parsed = parseReplayArgs(args)
  if (typeof parsed === 'string') {
    console.error(parsed)
    return EXIT.usage
  }
  const { run, turn, n } = parsed
  if (!existsSync(run) || !statSync(run).isDirectory()) {
    console.error(`no run folder at ${run}`)
    return EXIT.missing
  }
  const missing = missingForReplay(run, turn)
  if (missing.length > 0) {
    console.error(
      `${run} cannot replay turn ${turn}; missing: ${missing.join(', ')}\n(a run made before turn.sh kept snapshots needs a new run)`,
    )
    return EXIT.missing
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.error('run this with the token in the environment')
    return EXIT.usage
  }
  const budget = Number(process.env.LIVE_RUN_BUDGET_USD ?? 5)
  const root = repoRoot()
  const out = mkdtempSync(join(tmpdir(), `replay-${basename(run)}-t${turn}-`))
  const hasPackages = existsSync(join(run, 'snap', `before${turn}.packages`))

  console.log(`${stamp()} building the image (a few minutes the first time)`)
  const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
  sh('docker', [
    'build',
    '-q',
    '--build-arg',
    `NODE_VERSION=${nvmrc}`,
    '-t',
    'coach-live-run',
    HERE,
  ])

  let spent = 0
  const done: string[] = []
  for (let i = 1; i <= n; i++) {
    if (spent >= budget) {
      console.log(
        `STOP: ${spent.toFixed(3)} spent, the stop is ${budget}. ${n - i + 1} samples were not run.`,
      )
      break
    }
    const sample = join(out, `s${i}`)
    console.log(
      `${stamp()} sample ${i} of ${n} (expected 1-3 min); folder ${sample}, tail -f ${sample}/raw/turn${turn}.jsonl`,
    )
    prepareSample(run, turn, sample, root)
    spent += runSample(run, turn, sample, hasPackages)
    done.push(sample)
  }

  const scored = done.map((s) => scoreRun(s))
  console.log(
    `\nFail rate at turn ${turn} over ${done.length} replies (spend ${spent.toFixed(3)} USD):`,
  )
  console.log(formatRates(failRates(turn, scored)) || 'no line was marked')
  done.forEach((s, i) => {
    console.log(`\n--- reply ${i + 1}`)
    for (const l of scored[i] ?? [])
      if (new RegExp(`^line \\d+ FAIL T${turn}\\b`).test(l)) console.log(l)
    console.log(readFileSync(join(s, 'last.txt'), 'utf8'))
  })
  console.log(`\nSamples are in ${out}`)
  return 0
}

if (import.meta.main) process.exitCode = replayCommand(process.argv.slice(2))
