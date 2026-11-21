// Replays one turn of a saved live run several times, to test a wording change aimed at that turn
// without a whole run. Each sample starts from the run's state before the turn (the snapshot
// turn.sh took: the copy and the coach's session), with this checkout's CLAUDE.md and skills put
// in (the skills the coach had loaded are swapped in its saved session too), sends the persona's
// original message for that turn, and is marked by the scorer. The run folder is only read, except that
// samples go in a new folder under it (replays/) unless --out names one. A sample keeps only what
// the scorer and a reader open; the working copy that ran the turn is removed, also when it failed.
// Usage: node examples/live-run/replay.ts <run-dir> <turn> [n] [--out <folder>]
// Needs Docker and CLAUDE_CODE_OAUTH_TOKEN in the environment: the token goes to each sample's
// container through up.sh and is never printed. The stop (LIVE_RUN_BUDGET_USD, default 5) applies
// to the sum of the samples' spend.
// Exit codes: 64 usage, 66 the run folder lacks what a replay of that turn needs, 1 the image did not
// build or a sample failed (the samples done before it are still printed), 130 interrupted with
// Ctrl-C (run as a script, the process then dies of the signal itself).
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { EXIT } from '../../scripts/lib/problem.ts'
import { repoRoot } from '../../scripts/lib/workspace.ts'
import { failedAt, formatRow } from './findings.ts'
import { failRates, formatRates } from './rates.ts'
import {
  cacheSummary,
  costAfter,
  Interrupted,
  interruptedBy,
  missingForReplay,
  prepareReplaySample,
  snapshotHadPackages,
  totalAfter,
  trimReplaySample,
} from './run-folder.ts'
import { scoreFindings } from './score.ts'
import { describeSwap, swapSkillsInSample } from './swap.ts'

const INTERRUPTED = 130
const USAGE = 'usage: node examples/live-run/replay.ts <run-dir> <turn> [n] [--out <folder>]'
const HERE = import.meta.dirname

export { failRates, formatRates } from './rates.ts'

export type ReplayArgs = { run: string; turn: number; n: number; out?: string }

const wholeNumber = (s: string) => /^[1-9]\d*$/.test(s)

export const parseReplayArgs = (argv: string[]): ReplayArgs | string => {
  const flag = argv.indexOf('--out')
  const out = flag >= 0 ? argv[flag + 1] : undefined
  if (flag >= 0 && (out === undefined || out.startsWith('--')))
    return `--out needs a folder\n${USAGE}`
  const args = flag >= 0 ? argv.filter((_, i) => i !== flag && i !== flag + 1) : argv
  const [run, turn, n, ...extra] = args
  if (run === undefined || turn === undefined || extra.length > 0 || run.startsWith('--'))
    return USAGE
  if (!wholeNumber(turn)) return `the turn must be a whole number from 1: "${turn}"\n${USAGE}`
  if (n !== undefined && !wholeNumber(n))
    return `the count must be a whole number from 1: "${n}"\n${USAGE}`
  const parsed = { run, turn: Number(turn), n: n === undefined ? 5 : Number(n) }
  return out === undefined ? parsed : { ...parsed, out }
}

// A hook that runs this (pre-push) sets GIT_DIR and friends, which would send a git call here to
// the hook's repository instead of the sample's.
export const withoutGitVariables = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')))

// Set by any step that Ctrl-C ended. The replay never returns to the event loop, so a process
// 'SIGINT' listener would not run until it is over; what the children report is the only signal.
let sawInterrupt = false

const noted = <T extends { status: number | null; signal: string | null }>(r: T): T => {
  if (interruptedBy(r)) sawInterrupt = true
  return r
}

const sh = (cmd: string, args: string[], cwd?: string) =>
  noted(spawnSync(cmd, args, { cwd, encoding: 'utf8', env: withoutGitVariables(process.env) }))

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
  interrupted: () => boolean
}): { done: string[]; spent: number; stop?: string; error?: string } => {
  const done: string[] = []
  let spent = 0
  for (let i = 1; i <= opts.n; i++) {
    // A Ctrl-C seen while the last sample ran must end the replay: the next sample is paid for.
    if (opts.interrupted()) return { done, spent }
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

// The last part of --out names each sample's Docker container (up.sh), so it must be a name Docker
// accepts; a part up.sh would reject is refused here, before a sample is paid for.
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

const sampleFolder = (out: string, i: number): string => join(out, `${basename(out)}-s${i}`)

// Where the samples go: the folder the caller named, which must not hold anything yet (a sample
// unpacked over an old one would mix the two), or a new one under the run folder, which the
// maintainer already keeps and cleans, never the system's temporary folder, where a replay's samples piled up unseen.
export const outputFolder = (run: string, turn: number, named?: string): string => {
  if (named === undefined) {
    mkdirSync(join(run, 'replays'), { recursive: true })
    return mkdtempSync(join(run, 'replays', `replay-t${turn}-`))
  }
  if (!CONTAINER_NAME.test(basename(named)))
    throw new Error(
      `the last part of --out, "${basename(named)}", becomes a Docker container name: start it with a letter or digit and use only letters, digits, _, . and -`,
    )
  if (existsSync(named) && (!statSync(named).isDirectory() || readdirSync(named).length > 0))
    throw new Error(`${named} already holds something; name a new or empty folder`)
  mkdirSync(named, { recursive: true })
  return named
}

const bytesIn = (path: string): number => {
  const st = lstatSync(path)
  return st.isDirectory()
    ? readdirSync(path).reduce((sum, f) => sum + bytesIn(join(path, f)), 0)
    : st.size
}

export const formatSize = (bytes: number): string => {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

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
  const changed = git('status', '--short', '--', 'CLAUDE.md', '.claude/skills')
  // A status cut short by Ctrl-C prints nothing, which would read as no change and skip the commit.
  if (changed.status !== 0)
    throw new Error(`could not read the wording under test: ${changed.stderr}`)
  if (changed.stdout.trim() === '') return
  const date = git('log', '-1', '--format=%cI').stdout.trim()
  const added = git('add', '--', 'CLAUDE.md', '.claude/skills')
  if (added.status !== 0) throw new Error(`could not stage the wording under test: ${added.stderr}`)
  const commit = noted(
    spawnSync(
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
    ),
  )
  if (commit.status !== 0)
    throw new Error(`could not commit the wording under test: ${commit.stderr}`)
}

// The sample is the run folder's own replay sample with this checkout's wording put in: the swap
// goes first, in the session the snapshot brought, and applyTree then commits the tree's skills.
export const prepareSample = (
  run: string,
  turn: number,
  sample: string,
  root: string,
): string[] => {
  prepareReplaySample(run, turn, sample)
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
    const t = noted(
      spawnSync(join(HERE, 'turn.sh'), [sample, String(turn), join(sample, 'reply.txt')], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, LIVE_RUN_BUDGET_USD: String(turnBudget) },
      }),
    )
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
    const up = noted(
      spawnSync(join(HERE, 'up.sh'), [sample], { stdio: ['ignore', 'ignore', 'inherit'] }),
    )
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

// A sample that failed or was cut short is trimmed the same way as a finished one: its working
// copy is what fills the disk, and the stream and cost log that say why it failed stay.
const trimKept = (sample: string) => {
  try {
    trimReplaySample(sample)
  } catch (e) {
    console.error(`could not trim ${sample}: ${e instanceof Error ? e.message : e}`)
  }
}

export const replayCommand = (args: string[], makeAdapter: MakeAdapter = dockerAdapter): number => {
  const checked = checkInputs(args)
  if (typeof checked === 'number') return checked
  // Ctrl-C reaches the running step too. With no listener Node would die of it on the spot and
  // skip the trims; this one does nothing but keep it alive, and the step's own death says so.
  sawInterrupt = false
  const keepAlive = () => undefined
  process.on('SIGINT', keepAlive)
  try {
    const code = replay(checked, makeAdapter, () => sawInterrupt)
    return sawInterrupt ? INTERRUPTED : code
  } finally {
    process.off('SIGINT', keepAlive)
  }
}

const replay = (
  checked: ReplayArgs & { budget: number },
  makeAdapter: MakeAdapter,
  interrupted: () => boolean,
): number => {
  const { run, turn, n, budget } = checked
  const root = repoRoot()
  let out: string
  try {
    out = outputFolder(run, turn, checked.out)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return EXIT.usage
  }
  const hasPackages = snapshotHadPackages(run, turn)
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
    interrupted,
    runOne: (i) => {
      const sample = sampleFolder(out, i)
      console.log(
        `${stamp()} sample ${i} of ${n} (expected 1-3 min); folder ${sample}, tail -f ${sample}/raw/turn${turn}.jsonl`,
      )
      try {
        const swapped = prepareSample(run, turn, sample, root)
        console.log(`${stamp()} sample ${i}: ${describeSwap(swapped)}`)
        // The unchecked steps of the preparation (chmod, git) may have been cut short.
        if (interrupted()) throw new Error('interrupted before the turn ran')
        return { sample, ...adapter.runSample(sample) }
      } catch (e) {
        if (e instanceof Interrupted) sawInterrupt = true
        throw e
      } finally {
        trimKept(sample)
      }
    },
  })
  if (stop) console.log(stop)
  if (error) console.error(error)
  if (done.length > 0) printResults(turn, done, spent)
  console.log(`\nSamples are in ${out} (${formatSize(bytesIn(out))})`)
  return error ? EXIT.problems : 0
}

// The signal is re-raised here, not in replayCommand, because a test calls replayCommand in its own
// process and must get a return value instead of being killed: a caller's
// loop (`for t in 38 72; do node replay.ts RUN $t; done`) only stops when the process dies of
// SIGINT, which a plain exit 130 does not do.
if (import.meta.main) {
  const code = replayCommand(process.argv.slice(2))
  process.exitCode = code
  if (code === INTERRUPTED) process.kill(process.pid, 'SIGINT')
}
