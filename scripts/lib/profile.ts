// Loads everything a CV may cite or is checked against: wins, history, the
// experience bank, the stack, competencies, CV rules and master.json. Problems
// within the profile itself are gathered here, so a run reports them once however
// many role CVs it checks.
import { join } from 'node:path'
import {
  type Competencies,
  CompetenciesFileSchema,
  type CvConfig,
  CvConfigSchema,
  type CvData,
  CvDataSchema,
  HistoryFileSchema,
  WinsFileSchema,
} from './cv-schema.ts'
import type { Identity } from './identity.ts'
import type { Problem } from './problem.ts'
import { fileProblem, readDir, readFile, yaml } from './read-file.ts'
import { buildSources, type Sources } from './sources.ts'
import { StackFileSchema } from './stack.ts'

export type Profile = {
  sources: Sources
  competencies: Competencies
  config: CvConfig
  master: CvData
}

// The identity is read once by the workspace, which also needs its name and timezone, so
// its problems arrive here rather than being found twice. The competency pack it names
// decides which file under config/competencies/ is read.
export const loadProfile = (
  root: string,
  ident: { identity: Identity | undefined; problems: Problem[] },
): { profile: Profile | undefined; problems: Problem[] } => {
  const at = (path: string) => join(root, path)
  if (!ident.identity) return { profile: undefined, problems: ident.problems }
  const packFile = `config/competencies/${ident.identity.competency_pack}.yaml`
  const wins = readFile(at('profile/wins.yaml'), yaml(WinsFileSchema))
  const history = readFile(at('profile/history.yaml'), yaml(HistoryFileSchema))
  const stack = readFile(at('profile/stack.yaml'), (text) => ({
    text,
    file: yaml(StackFileSchema)(text),
  }))
  const bank = readDir(
    at('experience-bank'),
    (name) => name.endsWith('.md') && name !== 'README.md',
  )
  const competencies = readFile(at(packFile), yaml(CompetenciesFileSchema))
  const config = readFile(at('config/cv.yaml'), yaml(CvConfigSchema))
  const master = readFile(at('cv/master.json'), (text) => CvDataSchema.parse(JSON.parse(text)))
  const problems = [
    ...ident.problems,
    ...fileProblem('profile/wins.yaml', wins),
    ...fileProblem('profile/history.yaml', history),
    ...fileProblem('profile/stack.yaml', stack),
    ...fileProblem('experience-bank', bank),
    ...fileProblem(packFile, competencies),
    ...fileProblem('config/cv.yaml', config),
    ...fileProblem('cv/master.json', master),
  ]
  const [w, h, s, b, c, cfg, m] = [
    wins.data,
    history.data,
    stack.data,
    bank.data,
    competencies.data,
    config.data,
    master.data,
  ]
  if (!(w && h && s && b && c && cfg && m)) return { profile: undefined, problems }
  const { sources, problems: found } = buildSources({
    wins: w.wins,
    history: h.roles,
    bank: b,
    stack: s,
    // Bank tags may be competency ids or the win themes the competency pack (config/competencies/<pack>.yaml) lists.
    tags: [...c.competencies.map((x) => x.id), ...c.themes],
  })
  problems.push(...found)
  return { profile: { sources, competencies: c, config: cfg, master: m }, problems }
}
