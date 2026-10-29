import { describe, expect, it } from 'vitest'
import { type Problem, summary } from '../lib/problem.ts'

const error = (message: string): Problem => ({ slug: 'acme-engineer', level: 'error', message })
const warning = (message: string): Problem => ({ slug: 'acme-engineer', level: 'warning', message })

describe('summary', () => {
  it('counts nothing when there are no problems', () => {
    expect(summary([], { warningsShown: false })).toBe('0 error(s), 0 warning(s)')
  })

  it('counts errors only, with no hint when there are no warnings to hide', () => {
    const problems = [
      error('record.yaml is missing'),
      error('events.md line 7: expected 5 columns'),
    ]
    expect(summary(problems, { warningsShown: false })).toBe('2 error(s), 0 warning(s)')
  })

  it('counts warnings only, with no hint when they were shown', () => {
    const problems = [
      warning('date is month precision'),
      warning('no bullet'),
      warning('gap lists evidence'),
    ]
    expect(summary(problems, { warningsShown: true })).toBe('0 error(s), 3 warning(s)')
  })

  it('hints at --warnings when warnings exist but are hidden', () => {
    const problems = [
      error('record.yaml is missing'),
      warning('date is month precision'),
      warning('no bullet'),
    ]
    expect(summary(problems, { warningsShown: false })).toBe(
      '1 error(s), 2 warning(s) (run with --warnings to list them)',
    )
  })
})
