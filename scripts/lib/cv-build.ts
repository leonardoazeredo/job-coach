// Builds a role's CV (CvData, as cv-pdf/ renders it) from
// cv/master.json, profile/history.yaml and the role's cv/bullets.yaml.
// Job identity fields always come from history.yaml public fields; master only
// supplies the name, contact details, the default headline and summary, skills
// and tech lists, and the training, projects, education and languages sections.
// It also lists the master-only lines, which the lint holds to stack limits.
import type { BulletsFile, CvData, CvJob, HistoryRole, SourcedText } from './cv-schema.ts'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// "2026-04" -> "April 2026"; anything else (e.g. "Present") is kept as written.
const monthLabel = (isoMonth: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(isoMonth)
  if (!match) return isoMonth
  const month = MONTHS.at(Number(match[2]) - 1)
  return month ? `${month} ${match[1]}` : isoMonth
}

// master.json ids may be a shorter or unhyphenated form of the history.yaml id, so a
// master job is matched by id first, then by those forms, then by company name.
const findMasterJob = (role: HistoryRole, master: CvData): CvJob | undefined =>
  master.work.find((job) => job.id === role.id) ??
  master.work.find((job) => job.id === role.id.replace(/-/g, '')) ??
  master.work.find((job) => role.id.startsWith(`${job.id}-`)) ??
  master.work.find((job) => job.company.startsWith(role.company))

const jobFromHistory = (role: HistoryRole, tech: string[] | undefined, bullets: string[]) => {
  const p = role.public
  const job: CvJob = {
    id: role.id,
    role: p.title,
    company: role.company,
    start: monthLabel(p.start),
    end: monthLabel(p.end),
    bullets,
  }
  if (p.location) job.location = p.location
  if (p.employment_type !== 'permanent') job.note = p.employment_type
  if (tech && tech.length > 0) job.tech = tech
  return job
}

// One sourced sentence of the variant, named by where it appears.
export type Line = { where: string; jobId: string | undefined; line: SourcedText }

// What a built CV says, as the PDF prints it, apart from the name, contact details and dates.
// Exhaustive over CvData so a new field is a compile error until someone decides
// whether it makes a claim. Only printed prose counts, never JSON keys or job ids,
// so an ad word cannot match structure. Name and contact fields stay out because
// keywordHits matches substrings: "git" would hit the GitHub URL.
const TEXT_OF: { [K in keyof CvData]: (cv: CvData) => string[] } = {
  name: () => [],
  location: () => [],
  email: () => [],
  phone: () => [],
  linkedin: () => [],
  github: () => [],
  headline: (cv) => [cv.headline],
  summary: (cv) => [cv.summary],
  skills: (cv) => cv.skills,
  work: (cv) =>
    cv.work.flatMap((j) => [
      j.role,
      j.company,
      ...(j.location ? [j.location] : []),
      ...(j.note ? [j.note] : []),
      ...j.bullets,
      ...(j.tech ?? []),
    ]),
  training: (cv) => cv.training,
  projects: (cv) => cv.projects,
  education: (cv) =>
    cv.education.flatMap((e) => [e.degree, e.institution, ...(e.location ? [e.location] : [])]),
  languages: (cv) => cv.languages,
}

const textOf = (cv: CvData): string =>
  Object.values(TEXT_OF)
    .flatMap((of) => of(cv))
    .join('\n')

// Text that only cv/master.json supplies, so no source backs it. Projects are
// the user's own R&D and count as the independent role; the rest belong to no role.
export type MasterLine = { where: string; roleId: string | undefined; text: string }

export type BuildResult = {
  cv: CvData
  errors: string[]
  text: string
  lines: Line[]
  masterOnly: MasterLine[]
}

export const buildCv = (
  variant: BulletsFile,
  master: CvData,
  history: HistoryRole[],
): BuildResult => {
  const errors: string[] = []
  const listed = new Map(variant.jobs.map((job) => [job.id, job]))
  for (const id of listed.keys()) {
    if (!history.some((role) => role.id === id)) {
      errors.push(`jobs: "${id}" is not a role id in profile/history.yaml`)
    }
  }
  // The jobs come newest first (Sources sorts them); a variant keeps that order and
  // only chooses which jobs appear.
  const work = history.flatMap((role) => {
    const job = listed.get(role.id)
    if (!job) return []
    const tech = job.tech ?? findMasterJob(role, master)?.tech
    return [
      jobFromHistory(
        role,
        tech,
        job.bullets.map((b) => b.text),
      ),
    ]
  })
  // Lines follow the rendered jobs, so a job missing from history has a build error
  // and no line problems.
  const lines: Line[] = [
    ...(variant.summary ? [{ where: 'summary', jobId: undefined, line: variant.summary }] : []),
    ...work.flatMap((job) =>
      (listed.get(job.id)?.bullets ?? []).map((line, i) => ({
        where: `${job.id} bullet ${i + 1}`,
        jobId: job.id,
        line,
      })),
    ),
  ]
  const cv: CvData = {
    ...master,
    headline: variant.headline ?? master.headline,
    summary: variant.summary?.text ?? master.summary,
    skills: variant.skills ?? master.skills,
    work,
  }
  const masterOnly: MasterLine[] = [
    ...(variant.summary ? [] : [{ where: 'summary', roleId: undefined, text: cv.summary }]),
    ...cv.training.map((text) => ({ where: 'training', roleId: undefined, text })),
    ...cv.projects.map((text) => ({ where: 'projects', roleId: 'independent', text })),
  ]
  return { cv, errors, text: textOf(cv), lines, masterOnly }
}
