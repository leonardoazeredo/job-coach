import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { MAX_PT, MIN_PT } from '../../fit.ts'
import {
  BODY_PT_MAX,
  BODY_PT_MIN,
  LAST_PAGE_MIN_FILL,
  LIGATURES,
  PAGE_MARGIN_PT,
  SECTION_HEADINGS,
  TEXT_PT_MAX,
} from '../constants.ts'
import { expectations } from '../expectations.ts'
import { FALLBACK_EXPECTATIONS } from '../fallback.ts'

describe('expectations', () => {
  it('drops skills of two characters or fewer', () => {
    const e = expectations({ skills: ['Go', 'C', 'AWS', 'React'] })
    assert.deepEqual(e.keywords, ['AWS', 'React'])
  })

  it('adds sentinel words only when present anywhere in the data', () => {
    const e = expectations({
      summary: 'Owned Configuration and offline-first workflows',
      skills: ['React'],
    })
    assert.deepEqual(e.keywords, ['React', 'configuration', 'workflows', 'offline'])
    const none = expectations({ skills: ['React'] })
    assert.deepEqual(none.keywords, ['React'])
    const office = expectations({ location: 'Head Office' })
    assert.deepEqual(office.keywords, ['office'])
  })

  it('always expects SUMMARY, SKILLS and WORK EXPERIENCE', () => {
    assert.deepEqual(expectations({}).headings, ['SUMMARY', 'SKILLS', 'WORK EXPERIENCE'])
  })

  it('adds TRAINING, PROJECTS and LANGUAGES only for non-empty sections', () => {
    const empty = expectations({ training: [], projects: [], languages: [] })
    assert.deepEqual(empty.headings, ['SUMMARY', 'SKILLS', 'WORK EXPERIENCE'])
    const full = expectations({ training: ['a'], projects: ['b'], languages: ['c'] })
    assert.deepEqual(full.headings, [
      'SUMMARY',
      'SKILLS',
      'WORK EXPERIENCE',
      'TRAINING',
      'PROJECTS',
      'LANGUAGES',
    ])
  })

  it('omits empty contact fields and keeps their order', () => {
    const e = expectations({
      email: 'a@b.co',
      phone: '',
      location: 'London',
      linkedin: 'linkedin.com/in/x',
      github: '',
    })
    assert.deepEqual(e.contact, ['a@b.co', 'London', 'linkedin.com/in/x'])
  })

  it('keeps jobs missing a company or a start so check [7] can fail them', () => {
    const job = { id: '', role: '', end: '', bullets: [] }
    const e = expectations({
      work: [
        { ...job, company: 'Acme', start: 'April 2026' },
        { ...job, company: '', start: 'May 2020' },
        { ...job, company: 'Globex', start: '' },
      ],
    })
    assert.deepEqual(e.pairs, [
      ['Acme', 'April 2026'],
      ['', 'May 2020'],
      ['Globex', ''],
    ])
  })

  it('treats absent company/start fields as empty strings', () => {
    const e = expectations({ work: [{ id: '', role: '', end: '', bullets: [] } as never] })
    assert.deepEqual(e.pairs, [['', '']])
  })

  it('sets email to null when absent or empty', () => {
    assert.equal(expectations({}).email, null)
    assert.equal(expectations({ email: '' }).email, null)
    assert.equal(expectations({ email: 'a@b.co' }).email, 'a@b.co')
  })
})

describe('fallback expectations', () => {
  it('uses the first contact entry as the email and expects no job pairs', () => {
    assert.equal(FALLBACK_EXPECTATIONS.email, FALLBACK_EXPECTATIONS.contact[0])
    assert.deepEqual(FALLBACK_EXPECTATIONS.pairs, [])
    assert.ok(FALLBACK_EXPECTATIONS.keywords.includes('TypeScript'))
    assert.ok(FALLBACK_EXPECTATIONS.headings.includes('WORK EXPERIENCE'))
  })
})

describe('constants', () => {
  it("derives the size band from the app's fit band", () => {
    assert.equal(BODY_PT_MIN, MIN_PT)
    assert.equal(BODY_PT_MAX, MAX_PT)
    assert.equal(TEXT_PT_MAX, 21.6)
    assert.equal(PAGE_MARGIN_PT, 36)
    assert.equal(LAST_PAGE_MIN_FILL, 0.45)
  })

  it('maps U+FB00-FB06 to their ASCII expansions', () => {
    assert.equal(Object.keys(LIGATURES).length, 7)
    assert.equal(LIGATURES['ﬃ'], 'ffi')
    assert.equal(LIGATURES['ﬆ'], 'st')
  })

  it('lists the rendered headings', () => {
    assert.ok(SECTION_HEADINGS.includes('PROFESSIONAL SUMMARY'))
    assert.equal(SECTION_HEADINGS.length, 7)
  })
})

describe('expectations with ad keywords', () => {
  it('adds them after the skills, once each, and drops two-character ones', () => {
    const e = expectations({ skills: ['React', 'Node.js'] }, ['react', 'Kafka', 'Go', 'kafka'])
    assert.deepEqual(e.keywords, ['React', 'Node.js', 'Kafka'])
  })
})
