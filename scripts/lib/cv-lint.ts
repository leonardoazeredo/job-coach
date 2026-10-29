// Checks a role's CV variant against the CV built from it; requirements.yaml
// is checked in requirements.ts. Three parts, by subject: line provenance
// (every line traces to an approved win, an answered experience-bank question,
// a job in history.yaml, or stack.yaml, and says only what those sources say),
// whole-CV claims (including limits on text only master.json supplies), and shape.
import type { BuildResult, Line, MasterLine } from './cv-build.ts'
import type { CvData, CvJob, SourcedText, Win } from './cv-schema.ts'
import { NOT_SPECIFIED } from './not-specified.ts'
import type { Problem } from './problem.ts'
import type { Profile } from './profile.ts'
import { type Sources, winRef } from './sources.ts'
import type { Stack } from './stack.ts'

const NUMBER = /\d+(?:[.,]\d+)*/g

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasWord = (text: string, word: string): boolean =>
  new RegExp(`(^|[^\\w])${escapeRegExp(word)}($|[^\\w])`, 'i').test(text)
const wordAsWritten = (text: string, word: string): string =>
  new RegExp(`(?<![\\w])${escapeRegExp(word)}(?![\\w])`, 'i').exec(text)?.[0] ?? word
const hasNumber = (text: string, num: string): boolean =>
  new RegExp(`(^|[^\\d.,])${escapeRegExp(num)}($|[^\\d])`).test(text)

type Found = { level: Problem['level']; message: string }
const error = (message: string): Found => ({ level: 'error', message })
const warning = (message: string): Found => ({ level: 'warning', message })

const checkMetrics = (text: string, wins: Win[]): string[] => {
  const problems: string[] = []
  const lower = text.toLowerCase()
  for (const win of wins) {
    if (win.metric === NOT_SPECIFIED) continue
    for (const clause of win.metric.split(';').map((c) => c.trim())) {
      const numbers = clause.match(NUMBER) ?? []
      const used = numbers.some((n) => hasNumber(text, n))
      if (used && !lower.includes(clause.toLowerCase())) {
        problems.push(
          `uses a number from ${winRef(win.slug)} without its metric quoted whole: "${clause}"`,
        )
      }
    }
  }
  return problems
}

type CitedSources = { problems: string[]; text: string; wins: Win[] }

const citeSources = (entry: Line, sources: Sources): CitedSources => {
  const cited = entry.line.sources.map((ref) => sources.cite(ref, entry.jobId))
  const citables = cited.flatMap((c) => (c.ok ? [c.citable] : []))
  return {
    problems: cited.flatMap((c) => (c.ok ? [] : [c.reason])),
    text: citables.map((c) => c.text).join('\n'),
    wins: citables.flatMap((c) => (c.kind === 'win' ? [c.win] : [])),
  }
}

const checkNumbers = (text: string, sourceText: string): string[] =>
  [...new Set(text.match(NUMBER) ?? [])]
    .filter((num) => !hasNumber(sourceText, num))
    .map((num) => `number "${num}" is in no cited source`)

const checkQualifiers = (text: string, wins: Win[], qualifiers: string[]): string[] =>
  wins.flatMap((win) =>
    qualifiers
      .filter((q) => win.action.toLowerCase().includes(q) && !text.toLowerCase().includes(q))
      .map((q) => `${winRef(win.slug)} says "${q}"; the line must too`),
  )

const checkStrength = (line: SourcedText, sourceText: string, groups: string[][]): string[] => {
  if (line.strength_ok_by) return []
  return groups.flatMap((group) => {
    const used = group.find((w) => hasWord(line.text, w))
    if (!used || group.some((w) => hasWord(sourceText, w))) return []
    return [
      `"${wordAsWritten(line.text, used)}" is stronger than its sources; use their verb or confirm it with the user`,
    ]
  })
}

const checkLine = (entry: Line, profile: Profile): string[] => {
  const cited = citeSources(entry, profile.sources)
  const { text } = entry.line
  return [
    ...cited.problems,
    ...checkNumbers(text, cited.text),
    ...checkMetrics(text, cited.wins),
    ...checkQualifiers(text, cited.wins, profile.config.qualifiers),
    ...checkStrength(entry.line, cited.text, profile.config.strength_words),
  ]
}

const lineProvenance = (lines: Line[], profile: Profile): Found[] =>
  lines.flatMap((entry) => checkLine(entry, profile).map((m) => error(`cv ${entry.where}: ${m}`)))

const checkNeverSay = (text: string, sources: Sources): string[] =>
  sources.neverSaidIn(text).map(({ phrase, ref }) => `never_say phrase from ${ref}: "${phrase}"`)

const checkHeadline = (headline: string, profile: Profile): string[] => {
  const titles = profile.sources.history().map((job) => job.public.title)
  return profile.config.seniority_words
    .filter((word) => hasWord(headline, word) && !titles.some((t) => hasWord(t, word)))
    .map((word) => `headline uses "${word}", a title the user has not held`)
}

// The skills list belongs to no job, so a limited item there always needs its claim_as.
const checkSkill = (skill: string, stack: Stack): string[] => {
  const claim = stack.claim(skill)
  if (claim.ok) return []
  if (claim.reason === 'not-in-stack') return [`skills: "${skill}" is not in profile/stack.yaml`]
  return [`skills: "${skill}" has a limit in profile/stack.yaml; write "${claim.claimAs}"`]
}

// Tech outside the stack only warns, for the user to confirm or drop; a limited
// item outside its roles fails. One claim per item decides which.
const checkTech = (job: CvJob, stack: Stack): Found[] =>
  (job.tech ?? []).flatMap((tech) => {
    const claim = stack.claim(tech, job.id)
    if (claim.ok) return []
    if (claim.reason === 'not-in-stack')
      return [warning(`${job.id}: tech "${tech}" is not in profile/stack.yaml; confirm or drop`)]
    return [
      error(
        `${job.id}: tech "${tech}" has a limit in profile/stack.yaml; write "${claim.claimAs}"`,
      ),
    ]
  })

const checkMasterOnly = (masterOnly: MasterLine[], stack: Stack): string[] =>
  masterOnly.flatMap(({ where, roleId, text }) =>
    stack.limitBreaches(text, roleId).map((m) => `${where}: ${m}`),
  )

const wholeCvClaims = ({ cv, text, masterOnly }: BuildResult, profile: Profile): Found[] => {
  const { stack } = profile.sources
  return [
    ...[
      ...checkNeverSay(text, profile.sources),
      ...stack.breaches(text),
      ...checkHeadline(cv.headline, profile),
      ...cv.skills.flatMap((skill) => checkSkill(skill, stack)),
      ...checkMasterOnly(masterOnly, stack),
    ].map(error),
    ...cv.work.flatMap((job) => checkTech(job, stack)),
  ].map((f) => ({ ...f, message: `cv: ${f.message}` }))
}

const shape = (cv: CvData, profile: Profile): Found[] => {
  const historyIds = profile.sources.history().map((job) => job.id)
  const recent = new Set(historyIds.slice(0, profile.config.recent_jobs))
  const listed = new Set(cv.work.map((j) => j.id))
  const { bullets_per_job: range } = profile.config
  return [
    ...historyIds.filter((id) => !listed.has(id)).map((id) => `job "${id}" is left out of this CV`),
    ...cv.work.flatMap((job) => {
      const [min, max] = recent.has(job.id) ? range.recent : range.older
      const n = job.bullets.length
      return n < min || n > max ? [`${job.id}: ${n} bullets, expected ${min} to ${max}`] : []
    }),
  ].map((m) => warning(`cv: ${m}`))
}

export const lintVariant = (slug: string, build: BuildResult, profile: Profile): Problem[] =>
  [
    ...lineProvenance(build.lines, profile),
    ...wholeCvClaims(build, profile),
    ...shape(build.cv, profile),
  ].map((f) => ({ slug, ...f }))
