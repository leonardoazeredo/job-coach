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
import { resultSessionId } from './stream.ts'

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

// The scorer reads the whole run, so a sample's output also holds findings from the turns before
// the replayed one, which every sample shares. A line gets a row when a sample passed it or failed
// it at any turn, so a line the scorer checks never goes missing; only a failure at the replayed
// turn counts toward its fail rate. A failure about a written file carries no turn, so it neither
// adds a row nor counts as a fail; such a line that passes still gets a row, always at 0. The turn
// count gets no row.
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

// A hook that runs this (pre-push) sets GIT_DIR and friends, which would send a git call here to
// the hook's repository instead of the sample's.
export const withoutGitVariables = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')))

const sh = (cmd: string, args: string[], cwd?: string) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', env: withoutGitVariables(process.env) })

// The session id a turn ended with is in the result line of its raw stream.
const sessionAfter = (run: string, turn: number): string => {
  const id = resultSessionId(readFileSync(join(run, 'raw', `turn${turn}.jsonl`), 'utf8'))
  if (id === undefined) throw new Error(`raw/turn${turn}.jsonl holds no result with a session id`)
  return id
}

// The cost line a turn left in costlog.txt is the session's running total; undefined when the
// log has no line for the turn.
export const totalAfter = (costlog: string, turn: number): number | undefined => {
  const line = costlog.split('\n').find((l) => l.startsWith(`turn ${turn} `))
  const total = line === undefined ? Number.NaN : Number(line.split(' ')[2])
  return Number.isFinite(total) ? total : undefined
}

// What one sample spent: its running total at the turn less the run's total before the turn.
export const sampleSpend = (costlog: string, turn: number, base: number): number => {
  const total = totalAfter(costlog, turn)
  if (total === undefined) throw new Error(`the cost log has no cost for turn ${turn}`)
  if (total < base) throw new Error(`the cost for turn ${turn} is below the run's total before it`)
  return total - base
}

// turn.sh stops when the log's total reaches its budget. The sample's log starts at the run's
// total before the turn, so the replay's budget is added to it: it is the budget for the replay.
export const turnBudget = (base: number, remaining: number): number => base + remaining

type Sample = { sample: string; spend: number }

// Runs samples one after another until n are done, the budget is reached or one fails; what was
// done is kept in every case, because it was paid for.
export const replaySamples = (opts: {
  n: number
  budget: number
  runOne: (i: number, remaining: number) => Sample
}): { done: string[]; spent: number; stop?: string; error?: string } => {
  const done: string[] = []
  let spent = 0
  for (let i = 1; i <= opts.n; i++) {
    if (shouldStop(spent, opts.budget))
      return { done, spent, stop: stopMessage(spent, opts.budget, i, opts.n) }
    try {
      const r = opts.runOne(i, opts.budget - spent)
      spent += r.spend
      done.push(r.sample)
    } catch (e) {
      return { done, spent, error: `sample ${i} failed: ${e instanceof Error ? e.message : e}` }
    }
  }
  return { done, spent }
}

// The replay's budget in dollars: unset is 5; anything else must be a number above 0.
export const parseBudget = (raw: string | undefined): number | string => {
  if (raw === undefined) return 5
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 && raw.trim() !== ''
    ? n
    : `LIVE_RUN_BUDGET_USD must be a number above 0: "${raw}"`
}

export const shouldStop = (spent: number, budget: number): boolean => spent >= budget

export const stopMessage = (spent: number, budget: number, i: number, n: number): string =>
  `STOP: ${spent.toFixed(3)} spent, the stop is ${budget}. ${n - i + 1} samples were not run.`

export const sampleFolder = (out: string, i: number): string => join(out, `${basename(out)}-s${i}`)

const costAfter = (run: string, turn: number): number =>
  totalAfter(readFileSync(join(run, 'costlog.txt'), 'utf8'), turn) ?? 0

// This checkout's CLAUDE.md and skills go into the sample's copy. They are committed there, as
// start.sh's copy of a commit has them, dated like the copy's last commit so the order of a
// history the coach reads does not change. In the middle of an update's merge the files are only
// written: a commit would end the merge the coach is in the middle of.
export const applyTree = (copy: string, root: string) => {
  cpSync(join(root, 'CLAUDE.md'), join(copy, 'CLAUDE.md'))
  rmSync(join(copy, '.claude', 'skills'), { recursive: true, force: true })
  cpSync(join(root, '.claude', 'skills'), join(copy, '.claude', 'skills'), { recursive: true })
  const git = (...a: string[]) => sh('git', ['-C', copy, ...a])
  if (git('rev-parse', '-q', '--verify', 'MERGE_HEAD').status === 0) return
  if (git('status', '--short', '--', 'CLAUDE.md', '.claude/skills').stdout.trim() === '') return
  const date = git('log', '-1', '--format=%cI').stdout.trim()
  const added = git('add', '--', 'CLAUDE.md', '.claude/skills')
  if (added.status !== 0) throw new Error(`could not stage the wording under test: ${added.stderr}`)
  const commit = spawnSync(
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
    {
      encoding: 'utf8',
      env: {
        ...withoutGitVariables(process.env),
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    },
  )
  if (commit.status !== 0)
    throw new Error(`could not commit the wording under test: ${commit.stderr}`)
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

type SampleJob = {
  run: string
  turn: number
  sample: string
  hasPackages: boolean
  remaining: number
}

const runSample = ({ run, turn, sample, hasPackages, remaining }: SampleJob): number => {
  const container = `coach-live-run-${basename(sample)}`
  const up = spawnSync(join(HERE, 'up.sh'), [sample], { stdio: ['ignore', 'ignore', 'inherit'] })
  if (up.status !== 0) throw new Error('the sample container did not start')
  try {
    if (hasPackages) {
      console.log(`${stamp()} installing the coach's packages (about 20 s)`)
      const ci = sh('docker', ['exec', container, 'npm', 'ci', '--silent'])
      if (ci.status !== 0) throw new Error("the coach's packages did not install")
    }
    const base = turn > 1 ? costAfter(run, turn - 1) : 0
    const t = spawnSync(join(HERE, 'turn.sh'), [sample, String(turn), join(sample, 'reply.txt')], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, LIVE_RUN_BUDGET_USD: String(turnBudget(base, remaining)) },
    })
    if (t.status !== 0) throw new Error(`turn.sh failed (exit ${t.status}); see ${sample}/raw`)
    return sampleSpend(readFileSync(join(sample, 'costlog.txt'), 'utf8'), turn, base)
  } finally {
    sh('docker', ['rm', '-f', container])
  }
}

// The arguments and the environment, checked before any Docker call; a number is the exit code.
const checkInputs = (args: string[]): (ReplayArgs & { budget: number }) | number => {
  const parsed = parseReplayArgs(args)
  if (typeof parsed === 'string') {
    console.error(parsed)
    return EXIT.usage
  }
  const { run, turn } = parsed
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
  const budget = parseBudget(process.env.LIVE_RUN_BUDGET_USD)
  if (typeof budget === 'string') {
    console.error(budget)
    return EXIT.usage
  }
  return { ...parsed, budget }
}

const printResults = (turn: number, done: string[], spent: number) => {
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
}

export const replayCommand = (args: string[]): number => {
  const checked = checkInputs(args)
  if (typeof checked === 'number') return checked
  const { run, turn, n, budget } = checked
  const root = repoRoot()
  const out = mkdtempSync(join(tmpdir(), `replay-${basename(run)}-t${turn}-`))
  const hasPackages = existsSync(join(run, 'snap', `before${turn}.packages`))

  console.log(`${stamp()} building the image (a few minutes the first time)`)
  const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
  const built = sh('docker', [
    'build',
    '-q',
    '--build-arg',
    `NODE_VERSION=${nvmrc}`,
    '-t',
    'coach-live-run',
    HERE,
  ])
  if (built.status !== 0) {
    console.error('the image did not build; is Docker running?')
    return EXIT.problems
  }

  const { done, spent, stop, error } = replaySamples({
    n,
    budget,
    runOne: (i, remaining) => {
      const sample = sampleFolder(out, i)
      console.log(
        `${stamp()} sample ${i} of ${n} (expected 1-3 min); folder ${sample}, tail -f ${sample}/raw/turn${turn}.jsonl`,
      )
      prepareSample(run, turn, sample, root)
      return { sample, spend: runSample({ run, turn, sample, hasPackages, remaining }) }
    },
  })
  if (stop) console.log(stop)
  if (error) console.error(error)
  if (done.length === 0) return EXIT.problems

  printResults(turn, done, spent)
  console.log(`\nSamples are in ${out}`)
  return 0
}

if (import.meta.main) process.exitCode = replayCommand(process.argv.slice(2))
