// Shapes of the files the per-role CV scripts read and write: the profile
// files they cite, the config they obey, and the two files cv-for-role
// writes per role (requirements.yaml and cv/bullets.yaml). The CV output
// mirrors CvData in cv-pdf/types.ts, which the PDF export renders.
import { z } from 'zod'
import type { CvData as RendererCvData } from '../cv-pdf/types.ts'

const str = z.string()
const strList = z.array(str).default([])

export const WinSchema = z.looseObject({
  slug: str,
  role: str,
  status: z.enum(['approved', 'proposed']),
  themes: strList,
  metric: str,
  action: str,
  never_say: strList,
  competencies: strList,
})
export type Win = z.infer<typeof WinSchema>
export const WinsFileSchema = z.looseObject({ wins: z.array(WinSchema) })

export const HistoryRoleSchema = z.looseObject({
  id: str,
  company: str,
  public: z.object({
    title: str,
    employment_type: str,
    start: str,
    end: str,
    location: str.optional(),
  }),
  summary: str.optional(),
})
export type HistoryRole = z.infer<typeof HistoryRoleSchema>
export const HistoryFileSchema = z.looseObject({ roles: z.array(HistoryRoleSchema) })

export const CompetencySchema = z.object({
  id: str,
  label: str,
  ad_words: strList,
  win_themes: strList,
  slots: z.array(str),
  questions: z.record(str, str),
})
export type Competency = z.infer<typeof CompetencySchema>
export const CompetenciesFileSchema = z.object({
  competencies: z.array(CompetencySchema),
  themes: z.array(str),
})
export type Competencies = z.infer<typeof CompetenciesFileSchema>

export const CvConfigSchema = z.object({
  strength_words: z.array(z.array(str).min(1)),
  qualifiers: z.array(str),
  seniority_words: z.array(str),
  recent_jobs: z.number().int().min(0).default(3),
  bullets_per_job: z.object({
    recent: z.tuple([z.number().int(), z.number().int()]),
    older: z.tuple([z.number().int(), z.number().int()]),
  }),
})
export type CvConfig = z.infer<typeof CvConfigSchema>

// pipeline/<slug>/requirements.yaml
export const RequirementSchema = z.object({
  id: z.string().regex(/^r\d+$/, 'ids are r1, r2, ...'),
  quote: str,
  kind: z.enum(['technology', 'competency', 'domain', 'scope', 'logistics']),
  competency: str.optional(),
  weight: z.enum(['must', 'strong', 'nice']),
  keywords: strList,
  status: z.enum(['covered', 'partial', 'gap', 'not-claimable', 'dropped']),
  evidence: z.array(z.object({ ref: str, slots: strList })).default([]),
  missing_slots: strList,
  note: str.optional(),
})
export type Requirement = z.infer<typeof RequirementSchema>
export const RequirementsFileSchema = z.object({
  role: str,
  jd: str.default('jd.md'),
  requirements: z.array(RequirementSchema),
})
export type RequirementsFile = z.infer<typeof RequirementsFileSchema>

// pipeline/<slug>/cv/bullets.yaml
export const SourcedTextSchema = z.object({
  text: str,
  sources: z.array(str).min(1, 'every line needs at least one source'),
  answers: strList,
  // Set once the user has confirmed the stronger verb.
  strength_ok_by: z.literal('user').optional(),
})
export type SourcedText = z.infer<typeof SourcedTextSchema>

export const VariantJobSchema = z.object({
  id: str,
  tech: z.array(str).optional(),
  bullets: z.array(SourcedTextSchema).default([]),
})
export type VariantJob = z.infer<typeof VariantJobSchema>

export const BulletsFileSchema = z.object({
  role: str,
  headline: str.optional(),
  summary: SourcedTextSchema.optional(),
  skills: z.array(str).optional(),
  jobs: z.array(VariantJobSchema).min(1),
})
export type BulletsFile = z.infer<typeof BulletsFileSchema>

// cv/master.json and every built cv.json; same keys as CvData in cv-pdf/types.ts
export const CvJobSchema = z.object({
  id: str,
  role: str,
  company: str,
  location: str.optional(),
  start: str,
  end: str,
  note: str.optional(),
  tech: z.array(str).optional(),
  bullets: z.array(str),
})
export type CvJob = z.infer<typeof CvJobSchema>

export const CvDataSchema = z.object({
  name: str,
  headline: str,
  location: str,
  email: str,
  phone: str,
  linkedin: str,
  github: str,
  summary: str,
  skills: z.array(str),
  work: z.array(CvJobSchema),
  training: z.array(str).default([]),
  projects: z.array(str).default([]),
  education: z
    .array(
      z.object({
        id: str,
        degree: str,
        institution: str,
        location: str.optional(),
        start: str,
        end: str,
      }),
    )
    .default([]),
  languages: z.array(str).default([]),
})
export type CvData = z.infer<typeof CvDataSchema>

// Fails the typecheck when either side lacks a required field of the other or their types
// conflict; an optional field added to only one side still passes.
const _rendererAcceptsSchema = (d: CvData): RendererCvData => d
const _schemaAcceptsRenderer = (d: RendererCvData): CvData => d
void [_rendererAcceptsSchema, _schemaAcceptsRenderer]
