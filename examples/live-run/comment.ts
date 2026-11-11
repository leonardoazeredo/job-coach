// Builds the comment that ends a live run: the commit it was made from, its turns and cost, each
// checklist line the judge failed with its turns and exact quotes, and the lines fixed since the
// previous run. It lives beside the run's scripts, not under scripts/, because it serves only the
// live-run harness; its test in scripts/__tests__ is what `npm run ci` runs.
// Usage: node examples/live-run/comment.ts <run-dir> [<previous-comment-or-report>]
// Writes <run-dir>/comment.md and prints its path; it posts nothing, so the last step of the guide
// is the one `gh issue comment --body-file`.
// The judge's report starts with a verdict line per checklist line (`line 26 FAIL T15, T16`),
// then holds the quotes (`line 26 T15 "..."`). The scorer's output is not read from a file:
// scoreRun is called, so its findings are the ones the judge was given.
// The previous verdicts are read from a comment saved to a file (the one posted for the run
// before, kept because run folders do not outlast a run) or from a judge report.
// Exit codes: 64 usage, 66 when the run folder lacks something the comment is built from, 65 when
// a report or previous verdict is there but holds no verdict line (ADR 0003: read, wrong shape).
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '../../scripts/lib/problem.ts'
import { scoreRun } from './score.ts'

const USAGE = 'usage: node examples/live-run/comment.ts <run-dir> [<previous-comment-or-report>]'

type Verdict = { line: number; status: string; where: string }

const VERDICT = /^line (\d+) (PASS|FAIL|BORDERLINE|SKIPPED)\b[ \t]*(.*)$/
const QUOTE = /^line (\d+) (\S+) "(.*)"$/

const verdicts = (report: string): Verdict[] =>
  report.split('\n').flatMap((l) => {
    const m = VERDICT.exec(l.trim())
    return m ? [{ line: Number(m[1]), status: m[2] ?? '', where: (m[3] ?? '').trim() }] : []
  })

const quotesFor = (report: string, line: number): string[] =>
  report.split('\n').flatMap((l) => {
    const m = QUOTE.exec(l.trim())
    return m && Number(m[1]) === line ? [`${m[2]} "${m[3]}"`] : []
  })

// Quotes and the judge's own words go into a code fence, so GitHub neither styles them nor turns
// `#123` into a link or `@name` into a notification; the fence outgrows any backticks inside.
const fenced = (lines: string[], info = '') => {
  const longest = Math.max(0, ...lines.flatMap((l) => (l.match(/`+/g) ?? []).map((r) => r.length)))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [`${fence}${info}`, ...lines, fence]
}

const isFault = (v: Verdict) => v.status === 'FAIL' || v.status === 'BORDERLINE'

const section = (report: string, title: string, status: string) =>
  verdicts(report)
    .filter((v) => v.status === status)
    .flatMap((v) => [
      `**${title}, line ${v.line}:**`,
      '',
      ...fenced([...(v.where === '' ? [] : [v.where]), ...quotesFor(report, v.line)]),
      '',
    ])

// The verdict lines go in verbatim, passes included, so a later run can read this comment back
// as its previous verdict: the same parse reads a judge report and a saved comment.
const verdictBlock = (report: string) => [
  '**Verdicts:**',
  '',
  ...fenced(
    report
      .split('\n')
      .filter((l) => VERDICT.test(l.trim()))
      .map((l) => l.trim()),
    'text',
  ),
  '',
]

// A file holding several saved comments (every run's, as the issue lists them) is read from its
// last verdict block, so an older run's faults are not counted again; a plain report has no marker.
const lastVerdicts = (previous: string) => verdicts(previous.split('**Verdicts:**').at(-1) ?? '')

const fixedSince = (report: string, previous: string | undefined): string[] => {
  if (previous === undefined) return ['No previous verdict was given, so no lines are compared.']
  const before = lastVerdicts(previous)
  const fixed = verdicts(report)
    .filter((v) => v.status === 'PASS')
    .filter((v) => before.some((p) => p.line === v.line && isFault(p)))
    .map((v) => v.line)
  return [
    fixed.length === 0
      ? 'No line failed in the previous run and passes in this one.'
      : `Fixed since the previous run: line ${fixed.join(', line ')}.`,
  ]
}

export const buildComment = (run: string, previousPath?: string): string => {
  const report = readFileSync(join(run, 'judge-report.txt'), 'utf8')
  // Both are printed in code spans, so a stray backtick in either file is dropped.
  const commit = readFileSync(join(run, 'commit.txt'), 'utf8').trim().replace(/`/g, '')
  // finish.sh writes `total_usd <n>`, already the running total, so it is read and never summed.
  const cost = readFileSync(join(run, 'cost.txt'), 'utf8')
    .trim()
    .replace(/^total_usd\s+/, '')
    .replace(/`/g, '')
  const turns = (readFileSync(join(run, 'transcript.md'), 'utf8').match(/^## Turn \d+\s*$/gm) ?? [])
    .length
  const flagged = [
    ...new Set(
      scoreRun(run).flatMap((l) => {
        const m = /^line (\d+) FAIL/.exec(l)
        return m ? [Number(m[1])] : []
      }),
    ),
  ]
  const previous = previousPath === undefined ? undefined : readFileSync(previousPath, 'utf8')
  return `${[
    `Live run at commit \`${commit}\`, ${turns} turns, \`$${cost}\`, judged on the checklist. All details are fictional.`,
    '',
    ...section(report, 'Failed', 'FAIL'),
    ...section(report, 'Borderline', 'BORDERLINE'),
    ...verdictBlock(report),
    ...fixedSince(report, previous),
    '',
    flagged.length === 0
      ? 'The scorer marked no line.'
      : `The scorer marked line ${flagged.join(', line ')}; the verdicts above are the judge's.`,
  ].join('\n')}\n`
}

export const commentCommand = (args: string[]): number => {
  const [run, previous, ...extra] = args
  if (run === undefined || extra.length > 0 || run.startsWith('--') || previous?.startsWith('--')) {
    console.error(USAGE)
    return EXIT.usage
  }
  if (!existsSync(run) || !statSync(run).isDirectory()) {
    console.error(`no run folder at ${run}`)
    return EXIT.missing
  }
  const absent = ['judge-report.txt', 'transcript.md', 'commit.txt', 'cost.txt'].filter(
    (f) => !existsSync(join(run, f)),
  )
  if (previous !== undefined && !existsSync(previous)) absent.push(previous)
  if (absent.length > 0) {
    console.error(`${run} is missing ${absent.join(', ')}; the comment is built from them`)
    return EXIT.missing
  }
  for (const f of [join(run, 'judge-report.txt'), ...(previous === undefined ? [] : [previous])]) {
    if (verdicts(readFileSync(f, 'utf8')).length === 0) {
      console.error(`${f} holds no \`line N PASS|FAIL|BORDERLINE|SKIPPED\` lines to build from`)
      return EXIT.data
    }
  }
  const out = join(run, 'comment.md')
  writeFileSync(out, buildComment(run, previous))
  console.log(out)
  return 0
}

if (import.meta.main) process.exitCode = commentCommand(process.argv.slice(2))
