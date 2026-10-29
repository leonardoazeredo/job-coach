// Everything a CV line may cite, and the one rule for what it may cite. Callers get
// parsed profile data in and citing out; the ref grammar, the bank's markdown and the
// indexes stay inside. A source ref is one of:
//   win:<slug>              an entry in profile/wins.yaml
//   bank:<role-id>#<n>      question n in experience-bank/<role-id>.md
//   history:<role-id>       a job in profile/history.yaml: company, title, employment type,
//                           location and summary
//   stack                   profile/stack.yaml (for skill and years-of-experience claims)
import type { HistoryRole, Win } from './cv-schema.ts'
import { error, type Problem } from './problem.ts'
import { buildStack, type Stack, type StackFile } from './stack.ts'

const STACK_REF = 'stack'

export type BankQuestion = {
  roleId: string
  number: string
  question: string
  tags: string[]
  summary: string
  answered: boolean
  text: string
}

const QUESTION = /^### (\d+[a-z]?)\.\s+(.*)$/
const TAGS = /^Tags:\s*(.*)$/
const SUMMARY = /^\*\*Summary:\*\*\s*(.*)$/

// A question runs from its `### n.` heading to the next heading of level 1 to 3;
// `Tags:` and `**Summary:**` lines are read from its body, and the whole body counts
// as citable text.
const parseBank = (roleId: string, markdown: string): BankQuestion[] => {
  const questions: BankQuestion[] = []
  let current: { number: string; question: string; lines: string[] } | undefined
  const flush = (): void => {
    if (!current) return
    const tagLine = current.lines.map((l) => TAGS.exec(l)?.[1]).find((t) => t !== undefined)
    const summary = current.lines.map((l) => SUMMARY.exec(l)?.[1]).find((s) => s !== undefined)
    questions.push({
      roleId,
      number: current.number,
      question: current.question,
      tags: (tagLine ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      summary: summary ?? '',
      answered: summary !== undefined,
      text: [current.question, ...current.lines].join('\n'),
    })
    current = undefined
  }
  for (const line of markdown.split('\n')) {
    const heading = QUESTION.exec(line)
    if (heading) {
      flush()
      current = { number: heading[1] ?? '', question: heading[2] ?? '', lines: [] }
    } else if (/^#{1,3} /.test(line)) {
      flush()
    } else {
      current?.lines.push(line)
    }
  }
  flush()
  return questions
}

export const winRef = (slug: string): string => `win:${slug}`
const historyRef = (jobId: string): string => `history:${jobId}`
const bankRef = (q: Pick<BankQuestion, 'roleId' | 'number'>): string =>
  `bank:${q.roleId}#${q.number}`

export type Citable =
  | { kind: 'win'; ref: string; role: string; text: string; win: Win }
  | { kind: 'bank'; ref: string; role: string; text: string; question: BankQuestion }
  | { kind: 'history'; ref: string; role: string; text: string; job: HistoryRole }
  | { kind: 'stack'; ref: typeof STACK_REF; role: undefined; text: string }

export type Kind = Citable['kind']

export type Cited = { ok: true; citable: Citable } | { ok: false; reason: string }

export type Sources = {
  // `under` is the job a line sits under: it may not cite another job's facts.
  cite: (ref: string, under?: string) => Cited
  citable: <K extends Kind>(kind: K) => Extract<Citable, { kind: K }>[]
  // Newest first by start month, whatever the order of history.yaml.
  history: () => HistoryRole[]
  neverSaidIn: (text: string) => { phrase: string; ref: string }[]
  readonly stack: Stack
}

type Parsed =
  | { kind: 'win'; slug: string }
  | { kind: 'bank'; roleId: string; number: string }
  | { kind: 'history'; jobId: string }
  | { kind: 'stack' }

const malformed = (ref: string, form: string) => ({
  ok: false as const,
  reason: `${ref}: malformed ref (write ${form})`,
})

const parseRef = (ref: string): { ok: true; parsed: Parsed } | { ok: false; reason: string } => {
  if (ref === STACK_REF) return { ok: true, parsed: { kind: 'stack' } }
  const [kind, rest = ''] = ref.split(/:(.*)/s)
  if (kind === 'win') {
    return rest ? { ok: true, parsed: { kind, slug: rest } } : malformed(ref, 'win:<slug>')
  }
  if (kind === 'bank') {
    const [, roleId, number] = /^([^#]+)#(.+)$/.exec(rest) ?? []
    return roleId && number
      ? { ok: true, parsed: { kind, roleId, number } }
      : malformed(ref, 'bank:<role-id>#<n>')
  }
  if (kind === 'history') {
    return rest ? { ok: true, parsed: { kind, jobId: rest } } : malformed(ref, 'history:<role-id>')
  }
  return { ok: false, reason: `${ref}: unknown source kind (use win:, bank:, history: or stack)` }
}

// Starts must be YYYY-MM: they are compared as strings, which orders them by month.
const newestFirst = (a: HistoryRole, b: HistoryRole): number => {
  if (a.public.start === b.public.start) return 0
  return a.public.start < b.public.start ? 1 : -1
}

// The sort keeps the CV right whatever the file order, but people and skills read
// history.yaml as written, so a file out of order is still reported.
const historyOrder = (jobs: HistoryRole[]): Problem[] =>
  jobs.slice(1).flatMap((job, i) => {
    const before = jobs[i]
    if (!before || newestFirst(before, job) <= 0) return []
    return [
      error(
        'profile/history.yaml',
        `roles are not newest first: "${before.id}" (${before.public.start}) is listed before "${job.id}" (${job.public.start})`,
      ),
    ]
  })

const isKind = <K extends Kind>(c: Citable, kind: K): c is Extract<Citable, { kind: K }> =>
  c.kind === kind

export const buildSources = (input: {
  wins: Win[]
  history: HistoryRole[]
  bank: Record<string, string>
  stack: { file: StackFile; text: string }
  tags: readonly string[]
}): { sources: Sources; problems: Problem[] } => {
  const wins = new Map(input.wins.map((w) => [w.slug, w]))
  // Array.prototype.sort is stable, so jobs starting in the same month keep file order.
  const history = [...input.history].sort(newestFirst)
  const jobs = new Map(history.map((h) => [h.id, h]))
  const bank = new Map(
    Object.entries(input.bank)
      .flatMap(([jobId, markdown]) => parseBank(jobId, markdown))
      .map((q) => [bankRef(q), q]),
  )
  const fail = (reason: string): Cited => ({ ok: false, reason })
  const citeWin = (ref: string, slug: string): Cited => {
    const win = wins.get(slug)
    if (!win) return fail(`${ref}: no such win in profile/wins.yaml`)
    if (win.status !== 'approved') return fail(`${ref}: win is not approved`)
    const text = `${win.action}\n${win.metric}`
    return { ok: true, citable: { kind: 'win', ref, role: win.role, text, win } }
  }
  const citeBank = (ref: string, at: { roleId: string; number: string }): Cited => {
    const question = bank.get(bankRef(at))
    if (!question) return fail(`${ref}: no such experience-bank question`)
    if (!question.answered) return fail(`${ref}: question has no answer`)
    return {
      ok: true,
      citable: { kind: 'bank', ref, role: at.roleId, text: question.text, question },
    }
  }
  const citeJob = (ref: string, jobId: string): Cited => {
    const job = jobs.get(jobId)
    if (!job) return fail(`${ref}: no such role in profile/history.yaml`)
    const pub = job.public
    const text = [job.company, pub.title, pub.employment_type, pub.location, job.summary].join('\n')
    return { ok: true, citable: { kind: 'history', ref, role: jobId, text, job } }
  }
  // Proposed wins and unanswered bank questions are not citable: they are not evidence yet.
  const citeAnyJob = (ref: string): Cited => {
    const parsed = parseRef(ref)
    if (!parsed.ok) return parsed
    const p = parsed.parsed
    switch (p.kind) {
      case 'win':
        return citeWin(ref, p.slug)
      case 'bank':
        return citeBank(ref, p)
      case 'history':
        return citeJob(ref, p.jobId)
      case 'stack':
        return {
          ok: true,
          citable: { kind: 'stack', ref: STACK_REF, role: undefined, text: input.stack.text },
        }
    }
  }
  // The stack belongs to no job, so a line under any job may cite it.
  const cite = (ref: string, under?: string): Cited => {
    const cited = citeAnyJob(ref)
    if (!cited.ok) return cited
    const { role } = cited.citable
    if (under && role && role !== under) {
      return fail(`${ref} belongs to ${role}, not ${under}`)
    }
    return cited
  }
  const refs: Record<Kind, string[]> = {
    win: [...wins.keys()].map(winRef),
    bank: [...bank.keys()],
    history: history.map((h) => historyRef(h.id)),
    stack: [STACK_REF],
  }
  const citable = <K extends Kind>(kind: K): Extract<Citable, { kind: K }>[] =>
    refs[kind].flatMap((ref) => {
      const cited = citeAnyJob(ref)
      return cited.ok && isKind(cited.citable, kind) ? [cited.citable] : []
    })
  // Proposed wins are checked too: a phrase is an inflation to avoid whether or not the
  // win is approved. An empty phrase is in every text, so it is skipped.
  const neverSaidIn = (text: string) => {
    const lower = text.toLowerCase()
    return input.wins.flatMap((w) =>
      w.never_say
        .filter((phrase) => phrase && lower.includes(phrase.toLowerCase()))
        .map((phrase) => ({ phrase, ref: winRef(w.slug) })),
    )
  }
  const stack = buildStack(input.stack.file)
  const allowed = new Set(input.tags)
  const problems = [
    ...historyOrder(input.history),
    ...stack.problems(history.map((h) => h.id)).map((m) => error('profile/stack.yaml', m)),
    ...[...bank].flatMap(([ref, q]) =>
      q.tags
        .filter((tag) => !allowed.has(tag))
        .map((tag) => error('experience-bank', `${ref}: unknown tag "${tag}"`)),
    ),
  ]
  return {
    sources: { cite, citable, history: () => [...history], neverSaidIn, stack },
    problems,
  }
}
