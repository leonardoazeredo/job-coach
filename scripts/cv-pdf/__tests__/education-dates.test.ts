import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CvDataSchema } from '../../lib/cv-schema.ts'
import { CvDocument } from '../CvDocument.tsx'

// A CV that gives no start date for a course must still parse and print without a dangling
// separator, since onboarding leaves the key out rather than writing an empty string.
const base = {
  name: 'Sam Example',
  headline: 'Planner',
  location: 'Leeds',
  email: 'sam@example.test',
  phone: '0',
  linkedin: '',
  github: '',
  summary: 's',
  skills: [],
}
const job = { id: 'j1', role: 'Planner', company: 'Acme', start: 'March 2020', end: 'now' }

const parse = (work: unknown[], education: unknown[]) =>
  CvDataSchema.safeParse({ ...base, work, education })

const html = (education: unknown[]) => {
  const parsed = parse([{ ...job, bullets: [] }], education)
  if (!parsed.success) throw new Error(parsed.error.message)
  return renderToStaticMarkup(createElement(CvDocument, { data: parsed.data }))
}

const edu = { id: 'e1', degree: 'NVQ Level 2', institution: 'Leeds City College' }

describe('education dates', () => {
  it('accepts an entry with no start and shows only the end date', () => {
    const out = html([{ ...edu, end: '2012' }])
    expect(out).toContain('| 2012')
    expect(out).not.toContain(' - 2012')
  })

  it('shows no separator when an entry has no dates at all', () => {
    const out = html([{ ...edu, end: '' }])
    expect(out).toContain('Leeds City College')
    expect(out).not.toMatch(/Leeds City College[^<]*<span[^>]*>\|\s*<\/span>/)
  })

  it('still joins a start and an end', () => {
    expect(html([{ ...edu, start: '2010', end: '2012' }])).toContain('| 2010 - 2012')
  })

  it('still requires a job start', () => {
    const { start: _start, ...noStart } = job
    expect(parse([{ ...noStart, bullets: [] }], []).success).toBe(false)
  })
})
