import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { formatResult, section } from '../report.ts'
import {
  checkContact,
  checkJobDates,
  checkPageBalance,
  checkTextOnce,
  checkTextSizes,
  describeLinks,
} from '../structureChecks.ts'

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

describe('checkTextSizes', () => {
  it('fails a body below the band, naming smallest and body', () => {
    const r = checkTextSizes(new Map([[9.5, 100]]))
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines, [
      'smallest 9.5pt, body 9.5pt, largest 9.5pt',
      'FAIL smallest 9.5pt is under 10pt',
      'FAIL body 9.5pt is outside 10-12pt',
    ])
  })
  it('passes the name at exactly the maximum', () => {
    const r = checkTextSizes(
      new Map([
        [11, 500],
        [21.6, 10],
      ]),
    )
    assert.deepEqual(r, {
      failures: 0,
      lines: ['smallest 11pt, body 11pt, largest 21.6pt', 'ok   within the band'],
    })
  })
  it('fails a largest glyph over the maximum', () => {
    const r = checkTextSizes(
      new Map([
        [11, 500],
        [22, 3],
      ]),
    )
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines.slice(1), ['FAIL largest 22pt is over 21.6pt'])
  })
  it('tolerates 0.1pt under the minimum and over the maximum body', () => {
    assert.equal(
      checkTextSizes(
        new Map([
          [9.9, 5],
          [12.1, 100],
        ]),
      ).failures,
      0,
    )
    assert.equal(
      checkTextSizes(
        new Map([
          [9.8, 5],
          [11, 100],
        ]),
      ).failures,
      1,
    )
  })
  it('fails a body larger than the band even when the smallest is fine', () => {
    const r = checkTextSizes(
      new Map([
        [12.2, 100],
        [11, 5],
      ]),
    )
    assert.equal(r.failures, 1)
    assert.ok(r.lines.includes('FAIL body 12.2pt is outside 10-12pt'))
  })
  it('takes the most common size as body, the first seen on a tie', () => {
    const r = checkTextSizes(
      new Map([
        [11, 50],
        [10.5, 50],
      ]),
    )
    assert.equal(r.lines[0], 'smallest 10.5pt, body 11pt, largest 11pt')
  })
  it('fails with the read error when sizes could not be read', () => {
    assert.deepEqual(checkTextSizes(null, 'ValueError: bad pdf'), {
      failures: 1,
      lines: ['FAIL could not read glyph sizes: ValueError: bad pdf'],
    })
    assert.deepEqual(checkTextSizes(null), {
      failures: 1,
      lines: ['FAIL could not read glyph sizes'],
    })
  })
  it('fails an empty map', () => {
    assert.deepEqual(checkTextSizes(new Map()), {
      failures: 1,
      lines: ['FAIL no glyphs found; cannot establish the text size'],
    })
  })
})

describe('checkPageBalance', () => {
  // 792pt page, 36pt margins: 720pt usable, so 45% fill is yMax 36 + 324 = 360.
  const two = (yMax: number[], lastLinePerPage = ['a line']) => ({
    pages: 2,
    lastPageHeight: 792,
    lastPageYMax: yMax,
    lastLinePerPage,
  })
  it('passes a single page without measuring', () => {
    const r = checkPageBalance({ pages: 1, lastPageYMax: [], lastLinePerPage: [] })
    assert.deepEqual(r, { failures: 0, lines: ['ok   single page'] })
  })
  it('fails a last page at 44%', () => {
    const r = checkPageBalance(two([36 + 0.44 * 720]))
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines, ['FAIL page 2 is 44% full; trim to drop the page or add content'])
  })
  it('passes a last page at exactly 45%', () => {
    const r = checkPageBalance(two([360]))
    assert.deepEqual(r, { failures: 0, lines: ['ok   page 2 is 45% full'] })
  })
  it('uses the lowest word on the page', () => {
    const r = checkPageBalance(two([100, 500, 200]))
    assert.equal(r.failures, 0)
    assert.deepEqual(r.lines, ['ok   page 2 is 64% full'])
  })
  it('fails when the last page cannot be measured', () => {
    assert.deepEqual(checkPageBalance(two([])), {
      failures: 1,
      lines: ['FAIL could not measure page 2'],
    })
    const noHeight = { pages: 2, lastPageYMax: [400], lastLinePerPage: ['x'] }
    assert.equal(checkPageBalance(noHeight).failures, 1)
  })
  it('fails a heading stranded at the end of a non-final page', () => {
    const r = checkPageBalance(two([700], ['Projects']))
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines, [
      'ok   page 2 is 92% full',
      `FAIL heading "Projects" is the last line of page 1`,
    ])
  })
  it('checks every non-final page and ignores the final one', () => {
    const r = checkPageBalance({
      pages: 3,
      lastPageHeight: 792,
      lastPageYMax: [700],
      lastLinePerPage: ['EDUCATION', 'body text', 'LANGUAGES'],
    })
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines.slice(1), [`FAIL heading "EDUCATION" is the last line of page 1`])
  })
  it('does not flag a non-heading last line', () => {
    assert.equal(checkPageBalance(two([700], ['Worked on PROJECTS daily'])).failures, 0)
  })
  it('adds an underfull page and a stranded heading together', () => {
    const r = checkPageBalance(two([100], ['EDUCATION']))
    assert.equal(r.failures, 2)
  })
})

describe('checkTextOnce', () => {
  it('passes an email occurring once, ignoring case', () => {
    const r = checkTextOnce('Contact: Jane@Example.com', 'jane@example.com')
    assert.deepEqual(r, { failures: 0, lines: [`ok   "jane@example.com" occurs once`] })
  })
  it('fails an email occurring twice', () => {
    const r = checkTextOnce('a@b.co ... a@b.co', 'a@b.co')
    assert.deepEqual(r, {
      failures: 1,
      lines: [`FAIL "a@b.co" occurs 2 times; expected once`],
    })
  })
  it('fails an email occurring zero times', () => {
    const r = checkTextOnce('nothing', 'a@b.co')
    assert.deepEqual(r.lines, [`FAIL "a@b.co" occurs 0 times; expected once`])
    assert.equal(r.failures, 1)
  })
  it('skips with no email', () => {
    assert.deepEqual(checkTextOnce('anything', null), {
      failures: 0,
      lines: ['skip no email in the data'],
    })
    assert.equal(checkTextOnce('anything', '').failures, 0)
  })
})

describe('report', () => {
  it('formats a section header', () => {
    assert.equal(
      section(5, 'contact details present as visible text'),
      '\n  [5] contact details present as visible text',
    )
  })
  it('formats the result', () => {
    assert.equal(formatResult(0), '\n  RESULT: PASS')
    assert.equal(formatResult(3), '\n  RESULT: 3 failing check(s)')
  })
})
