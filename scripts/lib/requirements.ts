// Owns a role's requirements.yaml: what each status promises, which
// requirements the evidence search and the keyword check take part in, and
// whether the CV's lines answer them. Evidence finding and the role checks ask
// this module, and it reads the built CV's lines and text, so a status means the
// same thing everywhere.
import type { BuildResult, Line } from './cv-build.ts'
import type { Competencies, Competency, Requirement, RequirementsFile } from './cv-schema.ts'
import type { Problem } from './problem.ts'
import type { Sources } from './sources.ts'

export type RoleRequirements = {
  problems: Problem[]
  // Requirements the evidence search covers.
  searched: Requirement[]
  // Requirements that no line of cv/bullets.yaml answers; empty with no bullets file.
  unanswered: Requirement[]
  // Ad keywords from covered and partial requirements found in the CV text; empty with no build.
  keywords: string[]
}

// The one keyword matcher: evidence scoring and the ATS keyword list must agree
// on what counts as a hit. Two-letter keywords match inside too many words.
export const keywordHits = (text: string, keywords: string[]): string[] => {
  const lower = text.toLowerCase()
  return keywords.filter((k) => k.length > 2 && lower.includes(k.toLowerCase()))
}

const claimed = (r: Requirement): boolean => r.status === 'covered' || r.status === 'partial'

type Found = { errors: string[]; warnings: string[] }

const checkSlots = (r: Requirement, competency: Competency | undefined): string[] => {
  if (!competency) return []
  const slots = [...r.evidence.flatMap((e) => e.slots), ...r.missing_slots]
  return slots
    .filter((s) => !competency.slots.includes(s))
    .map((s) => `slot "${s}" is not a ${competency.id} slot`)
}

// Partial is not required to list missing slots: it is also used when the
// evidence only partly fits the ad, with every slot filled.
const checkStatus = (r: Requirement): Found => {
  const errors: string[] = []
  const warnings: string[] = []
  const hasEvidence = r.evidence.length > 0
  if (claimed(r) && !hasEvidence) errors.push(`${r.status} with no evidence`)
  if (r.status === 'covered' && r.missing_slots.length > 0) {
    errors.push(
      `covered with missing slots (${r.missing_slots.join(', ')}); mark it partial or fill them`,
    )
  }
  if ((r.status === 'gap' || r.status === 'not-claimable') && hasEvidence) {
    warnings.push(`${r.status} but lists evidence; update its status or remove the evidence`)
  }
  return { errors, warnings }
}

const checkRequirement = (
  r: Requirement,
  sources: Sources,
  competency: Competency | undefined,
): Found => {
  const errors: string[] = []
  if (r.kind === 'competency' && !competency) {
    errors.push(
      `competency "${r.competency ?? ''}" is not in the competency pack under config/competencies/`,
    )
  }
  for (const e of r.evidence) {
    const cited = sources.cite(e.ref)
    if (!cited.ok) errors.push(cited.reason)
  }
  const status = checkStatus(r)
  return {
    errors: [...errors, ...status.errors],
    warnings: [...checkSlots(r, competency), ...status.warnings],
  }
}

const checkAnswers = (lines: Line[], known: Set<string>): string[] =>
  lines.flatMap(({ where, line }) =>
    line.answers
      .filter((id) => !known.has(id))
      .map((id) => `cv ${where}: answers "${id}" is not in requirements.yaml`),
  )

// A must-weight requirement the CV claims is the stronger reason to add a line,
// so a covered must requirement gets that warning alone, not both.
const unansweredWarning = (r: Requirement): string | undefined => {
  if (r.weight === 'must' && claimed(r)) {
    return `must requirement marked ${r.status} is answered by no bullet`
  }
  if (r.status === 'covered') return 'covered but answered by no bullet'
  return undefined
}

export const roleRequirements = (
  slug: string,
  file: RequirementsFile,
  profile: { sources: Sources; competencies: Competencies },
  build?: BuildResult,
): RoleRequirements => {
  const byId = new Map(profile.competencies.competencies.map((c) => [c.id, c]))
  const ids = file.requirements.map((r) => r.id)
  const errors = ids
    .filter((id, i) => ids.indexOf(id) !== i)
    .map((id) => `requirements: duplicate id ${id}`)
  const warnings: string[] = []
  for (const r of file.requirements) {
    const competency = r.competency ? byId.get(r.competency) : undefined
    const found = checkRequirement(r, profile.sources, competency)
    errors.push(...found.errors.map((m) => `requirements ${r.id}: ${m}`))
    warnings.push(...found.warnings.map((m) => `requirements ${r.id}: ${m}`))
  }

  const lines = build?.lines ?? []
  const answered = new Set(lines.flatMap((l) => l.line.answers))
  const unanswered = build ? file.requirements.filter((r) => !answered.has(r.id)) : []
  errors.push(...checkAnswers(lines, new Set(ids)))
  for (const r of unanswered) {
    const message = unansweredWarning(r)
    if (message) warnings.push(`requirements ${r.id}: ${message}`)
  }

  const keywords = [...new Set(file.requirements.filter(claimed).flatMap((r) => r.keywords))]
  return {
    problems: [
      ...errors.map((message) => ({ slug, level: 'error' as const, message })),
      ...warnings.map((message) => ({ slug, level: 'warning' as const, message })),
    ],
    searched: file.requirements.filter((r) => r.status !== 'dropped' && r.kind !== 'logistics'),
    unanswered,
    keywords: build ? keywordHits(build.text, keywords) : [],
  }
}
