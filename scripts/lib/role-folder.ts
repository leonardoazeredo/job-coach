// Reads a role folder's record and events, and its requirements.yaml and
// cv/bullets.yaml when a command needs them. Role files are read only here, so
// a change to how one is read happens in one place; the workspace is the only caller.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import {
  type BulletsFile,
  BulletsFileSchema,
  type RequirementsFile,
  RequirementsFileSchema,
} from './cv-schema.ts'
import { type PipelineEvent, parseEvents } from './events.ts'
import { error, type Problem } from './problem.ts'
import { fileProblem, MISSING, readFile, yaml } from './read-file.ts'
import { type Record, RecordSchema } from './schema.ts'

export type LoadedRole = {
  slug: string
  dir: string
  record: Record | undefined
  events: PipelineEvent[]
  problems: Problem[]
}

// `pdfName` comes from identity.yaml (see identity.ts); the default appears only when
// identity.yaml is unreadable, and the role CV write is refused then.
export const rolePaths = (root: string, slug: string, pdfName = 'CV.pdf') => {
  const dir = join(root, 'pipeline', slug)
  const cv = join(dir, 'cv')
  return {
    dir,
    record: join(dir, 'record.yaml'),
    events: join(dir, 'events.md'),
    requirements: join(dir, 'requirements.yaml'),
    bullets: join(cv, 'bullets.yaml'),
    files: {
      cvJson: join(cv, 'cv.json'),
      keywords: join(cv, 'keywords.txt'),
      pdf: join(cv, pdfName),
      verify: join(cv, 'verify.txt'),
    },
  }
}
export type RolePaths = ReturnType<typeof rolePaths>

export const listSlugs = (root: string): string[] => {
  const pipeline = join(root, 'pipeline')
  if (!existsSync(pipeline)) return []
  return readdirSync(pipeline)
    .filter((name) => !name.startsWith('_') && statSync(join(pipeline, name)).isDirectory())
    .sort()
}

export const missing = (slug: string, name: string): Problem => error(slug, `${name} ${MISSING}`)

export const readRole = (root: string, slug: string): LoadedRole => {
  const paths = rolePaths(root, slug)
  const record = readFile(paths.record, yaml(RecordSchema))
  const events = readFile(paths.events, parseEvents)
  const problems = fileProblem(slug, record, 'record.yaml')
  if (record.data && record.data.slug !== slug)
    problems.push(error(slug, `record.yaml slug "${record.data.slug}" differs from the folder`))
  problems.push(...fileProblem(slug, events, 'events.md'))
  for (const message of events.data?.eventErrors ?? []) problems.push(error(slug, message))
  return {
    slug,
    dir: paths.dir,
    record: record.data,
    events: events.data?.events ?? [],
    problems,
  }
}

type CvFile = { requirements: RequirementsFile; bullets: BulletsFile }
export type CvFileKind = keyof CvFile
const CV_FILES: { [K in CvFileKind]: { name: string; schema: z.ZodType<CvFile[K]> } } = {
  requirements: { name: 'requirements.yaml', schema: RequirementsFileSchema },
  bullets: { name: 'cv/bullets.yaml', schema: BulletsFileSchema },
}

export const readCvFile = <K extends CvFileKind>(
  root: string,
  slug: string,
  kind: K,
): { data: CvFile[K] | undefined; missing: boolean; problems: Problem[] } => {
  const { name, schema } = CV_FILES[kind]
  const read = readFile(rolePaths(root, slug)[kind], yaml(schema))
  const problems = read.missing ? [] : fileProblem(slug, read, name)
  if (read.data && read.data.role !== slug)
    problems.push(error(slug, `${name} role "${read.data.role}" differs from the folder`))
  return { data: read.data, missing: read.missing === true, problems }
}
