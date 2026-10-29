import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { BulletsFile, RequirementsFile } from '../lib/cv-schema.ts'
import type { Record } from '../lib/schema.ts'

export const SLUG = 'larkspur-backend-engineer'

// The persona's own role folder, so the worked example and the shipped sample cannot drift.
const personaRole = join(import.meta.dirname, '../../examples/austin-backend/pipeline', SLUG)
const readRole = <T>(rel: string): T => parse(readFileSync(join(personaRole, rel), 'utf8'))

export const record = (overrides: Partial<Record> = {}): Record => ({
  slug: 'acme-engineer',
  company: 'Acme',
  job_title: 'Engineer',
  status: 'Applied',
  status_reason: null,
  tier: 1,
  fit: { verdict: 'Strong fit', reason: 'ok', stack_overlap_pct: 100 },
  dates: { identified: '2026-10-01', applied: '2026-10-03', last_activity: '2026-10-03' },
  next_action: { what: null, due: null },
  salary_range: 'Not specified',
  core_stack_matches: ['Python', 'Go'],
  secondary_stack_matches: ['Kafka'],
  tech_stack_gaps: [],
  hook: { win_slugs: ['bw-dock-scheduling'] },
  campaign: '2026-10',
  ...overrides,
})

// The worked example's requirements and variant are the persona's own, written only from
// approved wins and answered bank questions, so they pass the CV lint as they stand.
export const requirements = (): RequirementsFile => readRole('requirements.yaml')

export const variant = (): BulletsFile => readRole('cv/bullets.yaml')
