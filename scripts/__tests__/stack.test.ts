import { describe, expect, it } from 'vitest'
import { buildStack, type StackFile, StackFileSchema } from '../lib/stack.ts'

const file: StackFile = {
  core: ['Elixir (6+ years)', 'Postgres', 'Oban Jobs (Oban Pro)'],
  secondary: [
    'Bash',
    'Make, CMake, Ninja',
    'GCP (Cloud Run, GKE, BigQuery)',
    'Phoenix: LiveView, Channels, Jobs, Presence',
    'Metric tooling: Prometheus, Grafana',
    {
      name: 'Zig, with Mach',
      roles: ['independent'],
      claim_as: 'Zig, Mach (side projects)',
    },
  ],
  past: [
    { name: 'Perl', roles: [], claim_as: 'Perl (report generation, text munging)' },
    { name: 'Scala', roles: ['northwind'], claim_as: 'Scala (graduate scheme)' },
  ],
  tools: ['Git', { name: 'Terraform', roles: [], claim_as: 'Terraform (coursework)' }],
  do_not_claim: [{ item: 'Game engine development', patterns: ['game engine', 'unity'] }],
}
const stack = buildStack(file)

describe('sectionsOf (records: exact names)', () => {
  it.each([
    ['Elixir', ['core']],
    ['CMake', ['secondary']],
    ['BigQuery', ['secondary']],
    ['Oban Pro', ['core']],
    ['Jobs', ['secondary']],
    ['Zig', ['secondary']],
    ['Mach', ['secondary']],
    ['Terraform (coursework only)', ['tools']],
    ['Scala', ['past']],
  ])('%s is in %j', (item, sections) => expect(stack.sectionsOf(item)).toEqual(sections))

  it.each(['Elixirs', 'Metrics', 'Svelte'])('%s is in no section', (item) =>
    expect(stack.sectionsOf(item)).toEqual([]),
  )
})

describe('claim (CVs: fuzzy names, limits respected)', () => {
  it.each([
    ['Elixir', undefined],
    ['Metrics', undefined],
    ['CMake', undefined],
    ['Perl (report generation, text munging)', undefined],
    ['Terraform (coursework)', undefined],
    ['Zig, Mach (side projects)', undefined],
    ['Zig', 'independent'],
    ['Mach', 'independent'],
    ['Scala', 'northwind'],
  ])('%s is claimable (role %s)', (item, roleId) =>
    expect(stack.claim(item, roleId)).toEqual({ ok: true }),
  )

  it.each([
    ['Terraform', undefined, 'Terraform (coursework)'],
    ['Perl', undefined, 'Perl (report generation, text munging)'],
    ['Perl (web)', undefined, 'Perl (report generation, text munging)'],
    ['Zig', undefined, 'Zig, Mach (side projects)'],
    ['Scala', 'harbourline', 'Scala (graduate scheme)'],
  ])('%s needs its limit (role %s)', (item, roleId, claimAs) =>
    expect(stack.claim(item, roleId)).toEqual({ ok: false, reason: 'needs-limit', claimAs }),
  )

  it.each(['Svelte', 'Terraform modules', 'Clojure'])('%s is not in the stack', (item) =>
    expect(stack.claim(item)).toEqual({ ok: false, reason: 'not-in-stack' }),
  )
})

describe('covers (evidence: any section, limits ignored)', () => {
  it('matches limited and unlimited items alike', () => {
    expect(['Elixir', 'Terraform', 'Perl', 'Svelte'].filter((k) => stack.covers(k))).toEqual([
      'Elixir',
      'Terraform',
      'Perl',
    ])
  })
})

describe('breaches', () => {
  it('names the do_not_claim item and the pattern that matched', () => {
    expect(stack.breaches('Built a Unity prototype')).toEqual([
      'do_not_claim "Game engine development" (/unity/)',
    ])
    expect(stack.breaches('Perl reporting for text tooling')).toEqual([])
  })
})

describe('problems', () => {
  it('reports a limit naming a role that is not in history', () => {
    expect(stack.problems(['independent'])).toEqual([
      '"Scala" limit names role "northwind", which is not in profile/history.yaml',
    ])
    expect(stack.problems(['independent', 'northwind'])).toEqual([])
  })
})

describe('StackFileSchema', () => {
  it('rejects a do_not_claim item with no patterns', () => {
    const noPatterns = { ...file, do_not_claim: [{ item: 'Fortran', patterns: [] }] }
    expect(StackFileSchema.safeParse(noPatterns).success).toBe(false)
  })
})
