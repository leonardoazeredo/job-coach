import { describe, expect, it } from 'vitest'
import type { HistoryRole, Win } from '../lib/cv-schema.ts'
import { buildSources } from '../lib/sources.ts'
import type { StackFile } from '../lib/stack.ts'

const win = (slug: string, overrides: Partial<Win> = {}): Win => ({
  slug,
  role: 'acme',
  status: 'approved',
  themes: [],
  metric: 'Cut build time by 40%',
  action: 'Moved the build to Vite',
  never_say: [],
  competencies: [],
  ...overrides,
})

const job = (id: string, start: string, overrides: Partial<HistoryRole> = {}): HistoryRole => ({
  id,
  company: `${id} Ltd`,
  public: { title: 'Senior Engineer', employment_type: 'Full-time', start, end: 'present' },
  ...overrides,
})

const stackFile: StackFile = {
  core: ['TypeScript'],
  secondary: [],
  past: [{ name: 'C# / .NET', roles: ['acme'], claim_as: 'C# (Acme)' }],
  tools: [],
  do_not_claim: [],
}

const acmeBank = `# Experience bank: Acme

## Section 1: People

### 1. Who did you report to?

Tags: stakeholder-management

**Summary:** The CTO.

<details><summary>Original answer</summary>

> the cto

</details>

### 2. Unanswered question?

## Follow-ups for acme-role, 2026-10-25

### 26a. Did you ever push back?

Tags: influence-push-back, stakeholder-management

**Summary:** Yes, on the release date.
`

const build = (input: Partial<Parameters<typeof buildSources>[0]> = {}) =>
  buildSources({
    wins: [win('vite-build')],
    history: [job('acme', '2024-01'), job('globex', '2021-06')],
    bank: { acme: acmeBank },
    stack: { file: stackFile, text: 'stack.yaml text' },
    tags: ['stakeholder-management', 'influence-push-back'],
    ...input,
  })

describe('cite', () => {
  it('cites an approved win by its action and metric, under its job', () => {
    const cited = build().sources.cite('win:vite-build')
    expect(cited).toMatchObject({
      ok: true,
      citable: {
        kind: 'win',
        ref: 'win:vite-build',
        role: 'acme',
        text: 'Moved the build to Vite\nCut build time by 40%',
      },
    })
  })

  it.each([
    ['win:', 'win:: malformed ref (write win:<slug>)'],
    ['win:missing', 'win:missing: no such win in profile/wins.yaml'],
    ['win:draft', 'win:draft: win is not approved'],
    ['bank:acme', 'bank:acme: malformed ref (write bank:<role-id>#<n>)'],
    ['bank:acme#9', 'bank:acme#9: no such experience-bank question'],
    ['bank:acme#2', 'bank:acme#2: question has no answer'],
    ['history:', 'history:: malformed ref (write history:<role-id>)'],
    ['history:initech', 'history:initech: no such role in profile/history.yaml'],
    ['award:x', 'award:x: unknown source kind (use win:, bank:, history: or stack)'],
    ['stacks', 'stacks: unknown source kind (use win:, bank:, history: or stack)'],
  ])('refuses %s', (ref, reason) => {
    const { sources } = build({ wins: [win('draft', { status: 'proposed' })] })
    expect(sources.cite(ref)).toEqual({ ok: false, reason })
  })

  it('cites an answered bank question by its whole body, under the job it is filed under', () => {
    const cited = build().sources.cite('bank:acme#1')
    expect(cited).toMatchObject({
      ok: true,
      citable: { kind: 'bank', ref: 'bank:acme#1', role: 'acme' },
    })
    expect(cited.ok && cited.citable.text).toMatch(/^Who did you report to\?\n[\s\S]*> the cto/)
  })

  it('cites a job by its company, public fields and summary', () => {
    const { sources } = build({
      history: [
        job('acme', '2024-01', {
          summary: 'Led the web platform.',
          public: {
            title: 'Staff Engineer',
            employment_type: 'Contract',
            start: '2024-01',
            end: 'present',
            location: 'London',
          },
        }),
      ],
    })
    expect(sources.cite('history:acme')).toMatchObject({
      ok: true,
      citable: {
        kind: 'history',
        ref: 'history:acme',
        role: 'acme',
        text: 'acme Ltd\nStaff Engineer\nContract\nLondon\nLed the web platform.',
        job: { id: 'acme' },
      },
    })
  })

  it('cites the stack by the text of stack.yaml, under no job', () => {
    expect(build().sources.cite('stack')).toEqual({
      ok: true,
      citable: { kind: 'stack', ref: 'stack', role: undefined, text: 'stack.yaml text' },
    })
  })
})

describe('cite under a job', () => {
  const { sources } = build()

  it.each([
    ['win:vite-build', 'win:vite-build belongs to acme, not globex'],
    ['bank:acme#1', 'bank:acme#1 belongs to acme, not globex'],
    ['history:acme', 'history:acme belongs to acme, not globex'],
  ])('refuses %s cited under another job', (ref, reason) => {
    expect(sources.cite(ref, 'globex')).toEqual({ ok: false, reason })
  })

  it('cites a source under its own job, and the stack under any job', () => {
    expect(sources.cite('win:vite-build', 'acme').ok).toBe(true)
    expect(sources.cite('stack', 'globex').ok).toBe(true)
  })

  it('gives the source its own refusal before asking whose it is', () => {
    expect(sources.cite('win:missing', 'globex')).toEqual({
      ok: false,
      reason: 'win:missing: no such win in profile/wins.yaml',
    })
  })
})

describe('citable', () => {
  const { sources } = build({ wins: [win('vite-build'), win('draft', { status: 'proposed' })] })

  it('lists approved wins only', () => {
    expect(sources.citable('win').map((c) => c.ref)).toEqual(['win:vite-build'])
  })

  it('lists a win once when wins.yaml repeats its slug', () => {
    const repeated = build({ wins: [win('vite-build'), win('vite-build')] }).sources
    expect(repeated.citable('win').map((c) => c.ref)).toEqual(['win:vite-build'])
  })

  it('lists answered bank questions with their tags and summary', () => {
    expect(
      sources.citable('bank').map((c) => [c.ref, c.question.tags, c.question.summary]),
    ).toEqual([
      ['bank:acme#1', ['stakeholder-management'], 'The CTO.'],
      [
        'bank:acme#26a',
        ['influence-push-back', 'stakeholder-management'],
        'Yes, on the release date.',
      ],
    ])
  })

  it('lists every job and the stack', () => {
    expect(sources.citable('history').map((c) => c.ref)).toEqual(['history:acme', 'history:globex'])
    expect(sources.citable('stack').map((c) => c.ref)).toEqual(['stack'])
  })

  it.each(['win', 'bank', 'history', 'stack'] as const)(
    'cites back every %s it lists, as listed',
    (kind) => {
      for (const item of sources.citable(kind)) {
        expect(sources.cite(item.ref)).toEqual({ ok: true, citable: item })
      }
    },
  )
})

describe('history', () => {
  it('gives the jobs newest first, keeping jobs that start in the same month in file order', () => {
    const { sources } = build({
      history: [job('globex', '2021-06'), job('acme', '2024-01'), job('initech', '2024-01')],
    })
    expect(sources.history().map((j) => j.id)).toEqual(['acme', 'initech', 'globex'])
  })

  it('reports a history.yaml that is not newest first', () => {
    const { problems } = build({
      history: [job('globex', '2021-06'), job('acme', '2024-01'), job('initech', '2024-01')],
    })
    expect(problems).toEqual([
      {
        slug: 'profile/history.yaml',
        level: 'error',
        message: 'roles are not newest first: "globex" (2021-06) is listed before "acme" (2024-01)',
      },
    ])
  })

  it('reports nothing for a history.yaml already newest first', () => {
    expect(build().problems).toEqual([])
  })
})

describe('neverSaidIn', () => {
  const { sources } = build({
    wins: [
      win('vite-build', { never_say: ['halved the build', ''] }),
      win('draft', { status: 'proposed', never_say: ['zero downtime'] }),
    ],
  })

  it('finds each never-say phrase in the text, whatever its case, with the win it is from', () => {
    expect(sources.neverSaidIn('Halved the build and shipped it with Zero Downtime.')).toEqual([
      { phrase: 'halved the build', ref: 'win:vite-build' },
      { phrase: 'zero downtime', ref: 'win:draft' },
    ])
  })

  it('finds nothing when the text repeats no phrase', () => {
    expect(sources.neverSaidIn('Moved the build to Vite.')).toEqual([])
  })
})

describe('problems', () => {
  it('reports a stack limit that names a job not in history.yaml', () => {
    const { problems } = build({ history: [job('globex', '2021-06')] })
    expect(problems).toEqual([
      {
        slug: 'profile/stack.yaml',
        level: 'error',
        message: '"C# / .NET" limit names role "acme", which is not in profile/history.yaml',
      },
    ])
  })

  it('reports a bank tag outside the tag vocabulary, answered or not', () => {
    const { problems } = build({
      bank: { acme: '### 3. Anything else?\n\nTags: stakeholder-management, heroics\n' },
    })
    expect(problems).toEqual([
      { slug: 'experience-bank', level: 'error', message: 'bank:acme#3: unknown tag "heroics"' },
    ])
  })

  it('reports history order, then stack limits, then bank tags', () => {
    const { problems } = build({
      history: [job('globex', '2021-06'), job('initech', '2024-01')],
      tags: [],
    })
    expect(problems.map((p) => p.slug)).toEqual([
      'profile/history.yaml',
      'profile/stack.yaml',
      'experience-bank',
      'experience-bank',
      'experience-bank',
    ])
  })
})
