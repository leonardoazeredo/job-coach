// Replays one turn of a saved live run several times, to test a wording change aimed at that turn
// without a whole run. Each sample starts from the run's state before the turn (the snapshot
// turn.sh took: the copy and the coach's session), with this checkout's CLAUDE.md and skills put
// in (the skills the coach had loaded are swapped in its saved session too), sends the persona's
// original message for that turn, and is marked by the scorer. The run folder is only read; samples
// live in a new folder under the system's temporary folder.
// Usage: node examples/live-run/replay.ts <run-dir> <turn> [n]
// Needs Docker and CLAUDE_CODE_OAUTH_TOKEN in the environment: the token goes to each sample's
// container through up.sh and is never printed. The stop (LIVE_RUN_BUDGET_USD, default 5) applies
// to the sum of the samples' spend.
// Exit codes: 64 usage, 66 the run folder lacks what a replay of that turn needs, 1 the image did not
// build or a sample failed (the samples done before it are still printed).
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
import { failedAt, formatRow } from './findings.ts'
import { failRates, formatRates } from './rates.ts'
import {
  cacheSummary,
  costLine,
  readCostLog,
  readStream,
  runKind,
  totalAfter,
  transcriptBefore,
  writeKind,
} from './run-folder.ts'
import { scoreFindings } from './score.ts'
import { describeSwap, swapSkillsInSample } from './swap.ts'

const USAGE = 'usage: node examples/live-run/replay.ts <run-dir> <turn> [n]'
const HERE = import.meta.dirname

export { failRates, formatRates } from './rates.ts'

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

// A hook that runs this (pre-push) sets GIT_DIR and friends, which would send a git call here to
// the hook's repository instead of the sample's.
export const withoutGitVariables = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')))

const sh = (cmd: string, args: string[], cwd?: string) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', env: withoutGitVariables(process.env) })

// The session id a turn ended with is in the result of its raw stream.
const sessionAfter = (run: string, turn: number): string => {
  const id = readStream(readFileSync(join(run, 'raw', `turn${turn}.jsonl`), 'utf8')).sessionId
  if (id === undefined) throw new Error(`raw/turn${turn}.jsonl holds no result with a session id`)
  return id
}

// What one sample spent: its running total at the turn less the run's total before the turn.
export const sampleSpend = (costlog: string, turn: number, base: number): number => {
  const total = totalAfter(costlog, turn)
  if (total === undefined) throw new Error(`the cost log has no cost for turn ${turn}`)
  if (total < base) throw new Error(`the cost for turn ${turn} is below the run's total before it`)
  return total - base
}

// What a sample came to: what it spent (counted even when it failed, because it was paid for) and,
// when it did not finish, why.
export type SampleOutcome = { spend: number; failure?: string }

// The seam between the replay and what runs a sample. The real adapter is docker, up.sh and
// turn.sh (dockerAdapter); a test gives a fake one. The replay hands over its budget once, and what
// each sample may spend is the adapter's to work out; the replay sees only what a sample spent.
export type ReplayAdapter = {
  // undefined when the image is ready, else why it is not.
  build: () => string | undefined
  runSample: (sample: string) => SampleOutcome
}
export type AdapterJob = {
  run: string
  turn: number
  hasPackages: boolean
  budget: number
  root: string
}
export type MakeAdapter = (job: AdapterJob) => ReplayAdapter

type Sample = SampleOutcome & { sample: string }

// Runs samples one after another until n are done, the budget is reached or one fails; what was
// done is kept in every case, and what a sample that failed after spending spent counts, because it
// was paid for (a sample that throws before it runs spent nothing). The
// stop is checked between samples only: one sample may itself spend up to the whole budget, so a
// replay can end one budget over.
const replaySamples = (opts: {
  n: number
  budget: number
  runOne: (i: number) => Sample
}): { done: string[]; spent: number; stop?: string; error?: string } => {
  const done: string[] = []
  let spent = 0
  for (let i = 1; i <= opts.n; i++) {
    if (spent >= opts.budget)
      return { done, spent, stop: stopMessage(spent, opts.budget, i, opts.n) }
    let r: Sample
    try {
      r = opts.runOne(i)
    } catch (e) {
      return { done, spent, error: `sample ${i} failed: ${e instanceof Error ? e.message : e}` }
    }
    spent += r.spend
    if (r.failure !== undefined) {
      const paid = r.spend > 0 ? ` (${r.spend.toFixed(3)} USD already spent)` : ''
      return { done, spent, error: `sample ${i} failed: ${r.failure}${paid}` }
    }
    done.push(r.sample)
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

const stopMessage = (spent: number, budget: number, i: number, n: number): string =>
  `STOP: ${spent.toFixed(3)} spent, the stop is ${budget}. ${n - i + 1} samples were not run.`

const sampleFolder = (out: string, i: number): string => join(out, `${basename(out)}-s${i}`)

const costAfter = (run: string, turn: number): number => totalAfter(readCostLog(run), turn) ?? 0

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
      // The copy is a throwaway; the user's signing settings must not decide whether it commits.
      '-c',
      'commit.gpgsign=false',
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

// A sample folder has a run folder's shape, so turn.sh and the scorer work on it unchanged. It
// holds the run's transcript and raw streams up to the turn, which is how the scorer knows what
// came earlier. Reads the run folder and root; writes only the sample.
export const prepareSample = (
  run: string,
  turn: number,
  sample: string,
  root: string,
): string[] => {
  mkdirSync(sample, { recursive: true })
  const tar = sh('tar', ['-xzf', join(run, 'snap', `before${turn}.tgz`), '-C', sample])
  if (tar.status !== 0) throw new Error(`could not unpack the snapshot: ${tar.stderr}`)
  for (const d of ['raw', 'cachehome', 'tmpd']) mkdirSync(join(sample, d), { recursive: true })
  if (existsSync(join(run, 'engine')))
    cpSync(join(run, 'engine'), join(sample, 'engine'), { recursive: true })
  writeKind(sample, runKind(run))
  writeFileSync(join(sample, 'transcript.md'), transcriptBefore(run, turn))
  for (let k = 1; k < turn; k++)
    if (existsSync(join(run, 'raw', `turn${k}.jsonl`)))
      cpSync(join(run, 'raw', `turn${k}.jsonl`), join(sample, 'raw', `turn${k}.jsonl`))
  cpSync(join(run, 'raw', `reply${turn}.txt`), join(sample, 'reply.txt'))
  if (turn > 1) {
    writeFileSync(join(sample, 'session.id'), sessionAfter(run, turn - 1))
    writeFileSync(join(sample, 'costlog.txt'), costLine(turn - 1, costAfter(run, turn - 1)))
  }
  const swapped = swapSkillsInSample(sample, root)
  applyTree(join(sample, 'copy'), root)
  sh('chmod', ['-R', 'a+rwX', sample])
  return swapped
}

const stamp = () => `[${new Date().toTimeString().slice(0, 8)}]`

// Every sample gets the same turn.sh budget: the run's total before the turn plus the replay's
// budget, made of nothing else, so a later invocation with the same setting gets it too. Measured: a
// budget that differed between samples made each sample re-write the prompt cache; see the cost
// note in README.md. The sample's cost log starts at that total, so turn.sh's own stop cannot fire
// here and claude's --max-budget-usd is the only cap a sample has.
export const dockerAdapter: MakeAdapter = ({ run, turn, hasPackages, budget, root }) => {
  const base = turn > 1 ? costAfter(run, turn - 1) : 0
  const turnBudget = base + budget
  // The running total turn.sh logged for the turn; undefined when it logged none, which is when the
  // turn left no result.
  const totalOf = (sample: string): number | undefined => {
    const log = join(sample, 'costlog.txt')
    return totalAfter(existsSync(log) ? readFileSync(log, 'utf8') : '', turn)
  }
  // What a sample has spent so far; 0 when turn.sh logged no cost.
  const paid = (sample: string): number => Math.max((totalOf(sample) ?? base) - base, 0)
  const lastLine = (text: string | null | undefined) => (text ?? '').trim().split('\n').pop() ?? ''

  const build = (): string | undefined => {
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
    return built.status === 0 ? undefined : lastLine(built.stderr) || 'docker build failed'
  }

  // undefined when turn.sh succeeded; else why not, with what the sample spent before it failed.
  const runTurn = (sample: string): SampleOutcome | undefined => {
    const t = spawnSync(join(HERE, 'turn.sh'), [sample, String(turn), join(sample, 'reply.txt')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, LIVE_RUN_BUDGET_USD: String(turnBudget) },
    })
    if (t.status === 0) return undefined
    // With a cost logged the turn ran and its result holds the cause (an error or claude's budget);
    // the last line turn.sh printed is then the running total, which explains nothing.
    const cause =
      totalOf(sample) === undefined
        ? lastLine(t.stdout) || `${sample}/raw/turn${turn}.err holds why`
        : `the turn ended on an error or its budget; see the result in ${sample}/raw/turn${turn}.jsonl`
    return { spend: paid(sample), failure: `turn.sh failed (exit ${t.status}): ${cause}` }
  }

  const runSample = (sample: string): SampleOutcome => {
    const container = `coach-live-run-${basename(sample)}`
    const up = spawnSync(join(HERE, 'up.sh'), [sample], { stdio: ['ignore', 'ignore', 'inherit'] })
    if (up.status !== 0) return { spend: 0, failure: 'the sample container did not start' }
    try {
      if (hasPackages) {
        console.log(`${stamp()} installing the coach's packages (about 20 s)`)
        const ci = sh('docker', ['exec', container, 'npm', 'ci', '--silent'])
        if (ci.status !== 0) return { spend: 0, failure: "the coach's packages did not install" }
      }
      const failed = runTurn(sample)
      if (failed !== undefined) return failed
      return { spend: sampleSpend(readFileSync(join(sample, 'costlog.txt'), 'utf8'), turn, base) }
    } catch (e) {
      return { spend: paid(sample), failure: e instanceof Error ? e.message : String(e) }
    } finally {
      sh('docker', ['rm', '-f', container])
    }
  }
  return { build, runSample }
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
  const scored = done.map((s) => scoreFindings(s))
  const cache = done.map((s) => readFileSync(join(s, 'raw', `turn${turn}.jsonl`), 'utf8'))
  console.log(
    `\nFail rate at turn ${turn} over ${done.length} replies (spend ${spent.toFixed(3)} USD, ${cacheSummary(cache)}):`,
  )
  console.log(formatRates(failRates(turn, scored)) || 'no line was marked')
  done.forEach((s, i) => {
    console.log(`\n--- reply ${i + 1}`)
    for (const r of failedAt(scored[i] ?? [], turn)) console.log(formatRow(r))
    console.log(readFileSync(join(s, 'last.txt'), 'utf8'))
  })
}

export const replayCommand = (args: string[], makeAdapter: MakeAdapter = dockerAdapter): number => {
  const checked = checkInputs(args)
  if (typeof checked === 'number') return checked
  const { run, turn, n, budget } = checked
  const root = repoRoot()
  const out = mkdtempSync(join(tmpdir(), `replay-${basename(run)}-t${turn}-`))
  const hasPackages = existsSync(join(run, 'snap', `before${turn}.packages`))
  const adapter = makeAdapter({ run, turn, hasPackages, budget, root })

  console.log(`${stamp()} building the image (a few minutes the first time)`)
  const notBuilt = adapter.build()
  if (notBuilt !== undefined) {
    console.error(`the image did not build; is Docker running? ${notBuilt}`)
    return EXIT.problems
  }

  const { done, spent, stop, error } = replaySamples({
    n,
    budget,
    runOne: (i) => {
      const sample = sampleFolder(out, i)
      console.log(
        `${stamp()} sample ${i} of ${n} (expected 1-3 min); folder ${sample}, tail -f ${sample}/raw/turn${turn}.jsonl`,
      )
      const swapped = prepareSample(run, turn, sample, root)
      console.log(`${stamp()} sample ${i}: ${describeSwap(swapped)}`)
      return { sample, ...adapter.runSample(sample) }
    },
  })
  if (stop) console.log(stop)
  if (error) console.error(error)
  if (done.length > 0) printResults(turn, done, spent)
  console.log(`\nSamples are in ${out}`)
  return error ? EXIT.problems : 0
}

if (import.meta.main) process.exitCode = replayCommand(process.argv.slice(2))
