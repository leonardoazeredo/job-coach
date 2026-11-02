import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { checkContact, checkJobDates, describeLinks } from '../structureChecks.ts'

describe('checkContact', () => {
  const text = 'Jane Doe\nJane@Example.com | +44 7000 000000 | London'
  it('passes when every field is present, ignoring case', () => {
    const r = checkContact(text, ['jane@example.com', '+44 7000 000000', 'London'])
    assert.deepEqual(r, { failures: 0, lines: ['ok   3 contact fields in text layer'] })
  })
  it('fails once and names every missing field', () => {
    const r = checkContact(text, ['jane@example.com', 'github.com/', 'linkedin.com/in/'])
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines, [`FAIL missing: ["github.com/","linkedin.com/in/"]`])
  })
  it('passes with no expected fields', () => {
    assert.equal(checkContact('', []).failures, 0)
  })
})

describe('describeLinks', () => {
  it('does not fail URI links or an internal jump, and lists them', () => {
    const r = describeLinks([{ uri: 'https://a.example' }, { jump: true }])
    assert.equal(r.failures, 0)
    assert.deepEqual(r.lines, [`["https://a.example",null]`])
  })
  it('fails each non-URI action and keeps the URIs listed', () => {
    const r = describeLinks([
      { uri: 'mailto:a@b.example' },
      { action: 'Launch' },
      { action: 'JavaScript' },
    ])
    assert.equal(r.failures, 2)
    assert.deepEqual(r.lines, [
      'FAIL link action /Launch: only /URI links belong in a CV',
      'FAIL link action /JavaScript: only /URI links belong in a CV',
      `["mailto:a@b.example"]`,
    ])
  })
  it('says none when there are no links', () => {
    assert.deepEqual(describeLinks([]), {
      failures: 0,
      lines: ['none (fine if URLs are visible text)'],
    })
  })
  it('fails a /URI action that has no target string', () => {
    const r = describeLinks([{ malformedUri: true }])
    assert.equal(r.failures, 1)
    assert.equal(r.lines[0], 'FAIL malformed /URI action: no target string')
  })
  it('fails on a read error', () => {
    const r = describeLinks([], 'KeyError: boom')
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines, [
      'FAIL could not read annotations: KeyError: boom',
      'none (fine if URLs are visible text)',
    ])
  })
})

describe('checkJobDates', () => {
  it('passes when the date follows the company on the same line', () => {
    const r = checkJobDates('Acme Ltd, London | April 2026\nBuilt things', [
      ['Acme Ltd', 'April 2026'],
    ])
    assert.equal(r.failures, 0)
    assert.match(r.lines[0], /^ok {3}Acme Ltd +-> April 2026 +found near occurrence 1 of 1$/)
  })
  it('passes when the date is within 40 chars before the company', () => {
    const r = checkJobDates(`April 2026\n${'x'.repeat(25)}\nAcme Ltd`, [['Acme Ltd', 'April 2026']])
    assert.equal(r.failures, 0)
  })
  it('fails when the date is 300 characters away', () => {
    const t = `Acme Ltd${' '.repeat(300)}April 2026`
    const r = checkJobDates(t, [['Acme Ltd', 'April 2026']])
    assert.equal(r.failures, 1)
    assert.match(r.lines[0], /^FAIL Acme Ltd +-> April 2026 +NOT adjacent: "Acme Ltd/)
  })
  it('fails when the company is absent', () => {
    const r = checkJobDates('nothing here', [['Acme Ltd', 'April 2026']])
    assert.deepEqual(r, {
      failures: 1,
      lines: [`FAIL "Acme Ltd" not found in the text layer at all`],
    })
  })
  it('passes when a later occurrence carries the date', () => {
    const t = `Acme Ltd${' '.repeat(300)}Acme Ltd | June 2020`
    const r = checkJobDates(t, [['Acme Ltd', 'June 2020']])
    assert.equal(r.failures, 0)
    assert.match(r.lines[0], /found near occurrence 2 of 2$/)
  })
  it('reports an empty company as not found instead of looping', () => {
    const r = checkJobDates('anything at all', [['', 'April 2026']])
    assert.deepEqual(r, {
      failures: 1,
      lines: [`FAIL "" not found in the text layer at all`],
    })
  })
  it('fails an empty start date instead of matching vacuously', () => {
    const r = checkJobDates('Acme Ltd | April 2026', [['Acme Ltd', '']])
    assert.deepEqual(r, {
      failures: 1,
      lines: [`FAIL "Acme Ltd" has an empty start date`],
    })
  })
  it('prints an explicit skip line when there are no work entries', () => {
    assert.deepEqual(checkJobDates('anything', []), {
      failures: 0,
      lines: ['skip no work entries'],
    })
  })
  it('counts each failing pair', () => {
    const r = checkJobDates('Acme Ltd\nGlobex', [
      ['Acme Ltd', 'April 2026'],
      ['Globex', 'May 2019'],
    ])
    assert.equal(r.failures, 2)
    assert.equal(r.lines.length, 2)
  })
})
