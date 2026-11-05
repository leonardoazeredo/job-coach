// The repo's data opened at one root: the role folders under pipeline/, the
// profile and the config. Every scripts/*.ts command reads through here, so
// they all report the same problems. Rules, profile and records are read once, on first
// use; a role's CV files are read each time a check needs them. A data file that
// is missing or does not parse, or an output that cannot be written, becomes a Problem
// naming it, never an exception, so one bad file cannot hide the rest of a report;
// checks that need it are skipped.
import { join, resolve } from 'node:path'
import { type Board, computeBoard } from './board.ts'
import { type BuildResult, buildCv } from './cv-build.ts'
import { findEvidence, type RequirementEvidence } from './cv-evidence.ts'
import { lintVariant } from './cv-lint.ts'
import {
  type BulletsFile,
  HistoryFileSchema,
  type HistoryRole,
  type RequirementsFile,
} from './cv-schema.ts'
import { isLanguageTag, isTimezone, todayIn } from './dates.ts'
import { type Discovery, discovery as discoveryOver } from './discovery.ts'
import { type Identity, IdentitySchema, pdfFileName } from './identity.ts'
import { type OnboardingSection, onboardingStatus } from './onboarding.ts'
import { error, hasErrors, type Problem } from './problem.ts'
import { loadProfile, type Profile } from './profile.ts'
import { fileProblem, readFile, writeProblem, yaml } from './read-file.ts'
import { type RepoVisibility, repoVisibility, type VisibilityProbe } from './repo-visibility.ts'
import { roleRequirements } from './requirements.ts'
import { listSlugs, missing, readCvFile, readRole, rolePaths } from './role-folder.ts'
import { loadRules } from './rules.ts'
import type { Rules } from './schema.ts'
import { type StatusRules, statusRules } from './status-rules.ts'
import { titleGateProblems } from './title-gate.ts'
import { checkRecords } from './validate.ts'

export type { Discovery, ListingMatch, TrackedRole } from './discovery.ts'
export type { Profile } from './profile.ts'

export const repoRoot = (): string => resolve(import.meta.dirname, '..', '..')

// One of the programs under scripts/: it prints and returns its exit code, and never
// exits or throws over data, so a test can run it in-process on a temp repo.
export type Command = (args: string[], workspace: Workspace) => number | Promise<number>

export type RoleCv = {
  slug: string
  problems: Problem[]
  requirements: RequirementsFile | undefined
  variant: BulletsFile | undefined
  build: BuildResult | undefined
  keywords: string[]
  files: { cvJson: string; keywords: string; pdf: string; verify: string }
  // Candidates for each requirement, with the problems through the requirements step
  // (profile, folder, files, requirements as computed with the variant), none from the
  // build or lint. A missing requirements.yaml is a Problem here; a missing variant is not.
  evidence: () => { problems: Problem[]; evidence: RequirementEvidence[] }
  // Writes cv.json and keywords.txt unless an error stops it; returns every problem found,
  // including a file that could not be written.
  write: () => Problem[]
}

export type Workspace = {
  identity: () => { identity: Identity | undefined; problems: Problem[] }
  // The jobs in profile/history.yaml on their own, so a draft can name a job while other profile files are still to come.
  history: () => { history: HistoryRole[] | undefined; problems: Problem[] }
  rules: () => { rules: Rules | undefined; problems: Problem[] }
  profile: () => { profile: Profile | undefined; problems: Problem[] }
  // Undefined when it cannot be told; see repo-visibility.ts.
  visibility: () => Promise<RepoVisibility | undefined>
  check: () => { problems: Problem[]; roles: number }
  lintCvs: (slug?: string) => { problems: Problem[]; checked: number }
  roleCv: (slug: string) => RoleCv
  board: (today: string) => { board: Board | undefined; problems: Problem[] }
  // Onboarding sections whose files are missing or still hold the template placeholder; see lib/onboarding.ts.
  onboarding: () => OnboardingSection[]
  discovery: () => { discovery: Discovery | undefined; problems: Problem[] }
  // A given day (a command's --today) wins over the timezone and is returned as given;
  // the command checks it is a day first.
  today: (when?: { given?: string | undefined; now?: Date }) => {
    today: string | undefined
    problems: Problem[]
  }
}

// Which of the two CV files an operation needs. A missing file is a fact until an
// operation needs it; then it is a Problem.
type Need = { requirements: boolean; bullets: boolean }

// What one role's CV files gave, read once per handle.
type CheckedCv = {
  requirements: RequirementsFile | undefined
  variant: BulletsFile | undefined
  build: BuildResult | undefined
  keywords: string[]
  // At least one CV file exists.
  present: boolean
  // files → requirements → build → lint. Without a `need`, the lint's case, a file is
  // reported missing only when neither CV file exists.
  problems: (need?: Need) => Problem[]
  evidence: () => { problems: Problem[]; evidence: RequirementEvidence[] }
}

const unchecked: CheckedCv = {
  requirements: undefined,
  variant: undefined,
  build: undefined,
  keywords: [],
  present: false,
  problems: () => [],
  evidence: () => ({ problems: [], evidence: [] }),
}

// The requirements are computed once, with the variant when there is one, so every
// operation agrees on what is wrong. The requirements, the lint and the keyword
// selection all read the built CV, so the build runs first. Without a profile the files are read and
// nothing more.
const checkRoleCv = (root: string, slug: string, profile: Profile | undefined): CheckedCv => {
  const req = readCvFile(root, slug, 'requirements')
  const bul = readCvFile(root, slug, 'bullets')
  const neither = req.missing && bul.missing
  const files = ({ requirements, bullets }: Need): Problem[] => [
    ...(req.missing && requirements ? [missing(slug, 'requirements.yaml')] : req.problems),
    ...(bul.missing && bullets ? [missing(slug, 'cv/bullets.yaml')] : bul.problems),
  ]
  const lintNeed: Need = { requirements: neither, bullets: neither }
  const evidenceNeed: Need = { requirements: true, bullets: false }
  const read = { ...unchecked, requirements: req.data, variant: bul.data, present: !neither }
  if (!profile)
    return {
      ...read,
      problems: (need = lintNeed) => files(need),
      evidence: () => ({ problems: files(evidenceNeed), evidence: [] }),
    }
  const build = bul.data && buildCv(bul.data, profile.master, profile.sources.history())
  const reqs = req.data && roleRequirements(slug, req.data, profile, build)
  const reqProblems = reqs?.problems ?? []
  const checked: Problem[] = [...reqProblems]
  if (build) {
    for (const message of build.errors) checked.push(error(slug, `cv: ${message}`))
    checked.push(...lintVariant(slug, build, profile))
  }
  return {
    ...read,
    build,
    keywords: reqs?.keywords ?? [],
    problems: (need = lintNeed) => [...files(need), ...checked],
    evidence: () => ({
      problems: [...files(evidenceNeed), ...reqProblems],
      evidence: reqs ? findEvidence(reqs.searched, profile.sources, profile.competencies) : [],
    }),
  }
}

// The record check loads a copy with no pack, because onboarding leaves it unset until its
// pack step. Matching a CV against the fallback pack would still be matching it against a
// field the user never chose, so only the CV commands refuse.
const packRefusal = (id: Identity | undefined): Problem[] =>
  id && id.competency_pack === undefined ? [error('profile/identity.yaml', NO_PACK)] : []

type LoadedProfile = { profile: Profile | undefined; problems: Problem[] }

// What the CV commands read: no profile at all while the pack is unchosen.
const cvProfileOf = (id: Identity | undefined, load: () => LoadedProfile): LoadedProfile => {
  const refused = packRefusal(id)
  return refused.length > 0 ? { profile: undefined, problems: refused } : load()
}

const NO_PACK =
  'no competency pack is chosen yet, so the CV cannot be matched to your field. Choose one in the competency pack step of onboarding, then run this again'

const noFolder = (slug: string): Problem => error(slug, `no pipeline/${slug} folder`)

const memo = <T>(load: () => T): (() => T) => {
  let value: { v: T } | undefined
  return () => {
    value ??= { v: load() }
    return value.v
  }
}

// A write needs the build, and there is no build without the variant, so a write asks
// for the variant as a Problem, unlike the read paths. So does missing requirements:
// keywords.txt would be empty, and the export's keyword check would pass with nothing
// to check.
const writeCvFiles = (
  slug: string,
  files: RoleCv['files'],
  gate: Problem[],
  cv: CheckedCv,
): Problem[] => {
  const problems = [...gate, ...cv.problems({ requirements: true, bullets: true })]
  if (!cv.build || hasErrors(problems)) return problems
  const cvJson = writeProblem(
    slug,
    files.cvJson,
    `${JSON.stringify(cv.build.cv, null, 2)}\n`,
    'cv/cv.json',
  )
  const keywords = writeProblem(
    slug,
    files.keywords,
    cv.keywords.map((k) => `${k}\n`).join(''),
    'cv/keywords.txt',
  )
  // When only cv.json was written, it may sit beside an earlier keywords.txt that no
  // longer matches it.
  const stale = cvJson.length > 0 ? '' : '; cv/cv.json was written'
  problems.push(...cvJson, ...keywords.map((p) => ({ ...p, message: p.message + stale })))
  return problems
}

// Without a given day, the day in the timezone and locale in profile/identity.yaml. With no
// readable timezone or locale there is no safe today: the UTC date can differ from the local
// date for hours every day, so falling back to it would be silently wrong.
const todayOf = (
  read: { identity: Identity | undefined; problems: Problem[] },
  { given, now = new Date() }: Parameters<Workspace['today']>[0] = {},
): ReturnType<Workspace['today']> => {
  if (given !== undefined) return { today: given, problems: [] }
  const file = 'profile/identity.yaml'
  const { identity: id, problems } = read
  if (!id) return { today: undefined, problems }
  if (!isLanguageTag(id.locale))
    return {
      today: undefined,
      problems: [error(file, `locale "${id.locale}" is not a language tag`)],
    }
  if (!isTimezone(id.location.timezone))
    return {
      today: undefined,
      problems: [error(file, `location.timezone "${id.location.timezone}" is not a timezone`)],
    }
  return { today: todayIn(id.location.timezone, now, id.locale), problems }
}

type CheckedRules = { sr: StatusRules | undefined; problems: Problem[] }

// Inconsistent rules still yield sr, so a check goes on reporting record problems; only
// unreadable rules leave it undefined.
const statusRulesFrom = (rules: Rules | undefined): CheckedRules => {
  if (!rules) return { sr: undefined, problems: [] }
  const sr = statusRules(rules)
  return { sr, problems: sr.problems() }
}

// A board over inconsistent rules would misplace roles, so none is computed. Unreadable rules
// report their own problems.
const boardOf = (
  ruleProblems: Problem[],
  s: CheckedRules,
  roles: () => Parameters<typeof computeBoard>[0],
  today: string,
): ReturnType<Workspace['board']> => {
  if (!s.sr) return { board: undefined, problems: ruleProblems }
  if (s.problems.length > 0) return { board: undefined, problems: s.problems }
  return { board: computeBoard(roles(), s.sr, today), problems: s.problems }
}

const readIdentity = (root: string): ReturnType<Workspace['identity']> => {
  const read = readFile(join(root, 'profile/identity.yaml'), yaml(IdentitySchema))
  return { identity: read.data, problems: fileProblem('profile/identity.yaml', read) }
}

const readHistory = (root: string): ReturnType<Workspace['history']> => {
  const read = readFile(join(root, 'profile/history.yaml'), yaml(HistoryFileSchema))
  return { history: read.data?.roles, problems: fileProblem('profile/history.yaml', read) }
}

export const openWorkspace = (
  root = repoRoot(),
  probe: VisibilityProbe = repoVisibility,
): Workspace => {
  const slugs = memo(() => listSlugs(root))
  const roles = memo(() => slugs().map((slug) => readRole(root, slug)))
  const identity = memo(() => readIdentity(root))
  const history = memo(() => readHistory(root))
  const profile = memo(() => loadProfile(root, identity()))
  const cvProfile = () => cvProfileOf(identity().identity, profile)
  const rules = memo(() => loadRules(root))
  const visibility = memo(() => probe(root))
  // Built once per run, so the board and the record checker share one set of rules.
  const statusRulesOf = memo(() => statusRulesFrom(rules().rules))
  // A named slug must be a role folder: this also refuses paths such as "../profile".
  const known = (slug: string) => slugs().includes(slug)
  const paths = (slug: string) => {
    const name = identity().identity?.name
    return rolePaths(root, slug, name === undefined ? undefined : pdfFileName(name))
  }

  const check = () => {
    const r = rules()
    const p = profile()
    const s = statusRulesOf()
    const problems = [...r.problems, ...p.problems, ...s.problems]
    if (r.rules) problems.push(...titleGateProblems(r.rules.discovery))
    if (s.sr) problems.push(...checkRecords(s.sr, p.profile, roles()))
    if (p.profile) problems.push(...lintCvsWith(p.profile, slugs()).problems)
    return { problems, roles: roles().length }
  }

  // Profile problems are the caller's to report, once per run, not once per role.
  const lintCvsWith = (prof: Profile, list: string[]) => {
    const problems: Problem[] = []
    let checked = 0
    for (const slug of list) {
      const c = checkRoleCv(root, slug, prof)
      if (!c.present) continue
      problems.push(...c.problems())
      checked++
    }
    return { problems, checked }
  }

  // The gate, profile then folder, reports both as facts; a missing folder stops the
  // reading and a missing profile the checking.
  const openCv = (slug: string) => {
    const p = cvProfile()
    const folder = known(slug)
    const gate = [...p.problems, ...(folder ? [] : [noFolder(slug)])]
    return { gate, cv: folder ? checkRoleCv(root, slug, p.profile) : unchecked }
  }

  const lintCvs = (slug?: string) => {
    const p = cvProfile()
    if (slug === undefined) {
      if (!p.profile) return { problems: p.problems, checked: 0 }
      const all = lintCvsWith(p.profile, slugs())
      return { problems: [...p.problems, ...all.problems], checked: all.checked }
    }
    const { gate, cv } = openCv(slug)
    return { problems: [...gate, ...cv.problems()], checked: p.profile && cv.present ? 1 : 0 }
  }

  const roleCv = (slug: string): RoleCv => {
    const { gate, cv } = openCv(slug)
    const files = paths(slug).files
    const write = () => writeCvFiles(slug, files, gate, cv)
    const evidence = () => {
      const found = cv.evidence()
      return { problems: [...gate, ...found.problems], evidence: found.evidence }
    }
    return {
      slug,
      problems: [...gate, ...cv.problems()],
      requirements: cv.requirements,
      variant: cv.variant,
      build: cv.build,
      keywords: cv.keywords,
      files,
      evidence,
      write,
    }
  }

  const board = (today: string) => boardOf(rules().problems, statusRulesOf(), roles, today)

  // Without a readable rules.yaml there is no expiry window and no title expansion,
  // so no Discovery is built: matching over built-in defaults would hide what the rules say.
  const discovery = memo(() => {
    const r = rules()
    if (!r.rules) return { discovery: undefined, problems: r.problems }
    const d = discoveryOver(roles(), r.rules)
    return { discovery: d, problems: d.problems }
  })

  const today: Workspace['today'] = (when) => todayOf(identity(), when)

  const onboarding = () => onboardingStatus(root, identity().identity?.competency_pack)

  return {
    identity,
    history,
    rules,
    profile,
    visibility,
    check,
    lintCvs,
    roleCv,
    board,
    onboarding,
    discovery,
    today,
  }
}
