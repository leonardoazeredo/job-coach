import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  checkHeadings,
  checkInvisibleChars,
  checkKeywords,
  checkLigatures,
  checkStreamGaps,
  spaceRatio,
  streamIsUsable,
} from '../textChecks.ts'
import type { EngineText } from '../types.ts'

const engine = (name: string, text: string, streamOrder = false): EngineText => ({
  name,
  text,
  streamOrder,
})
const CLEAN = 'SUMMARY React and Node work experience'

describe('spaceRatio / streamIsUsable', () => {
  it('is zero for empty text and the space fraction otherwise', () => {
    assert.equal(spaceRatio(''), 0)
    assert.equal(spaceRatio('a b '), 0.5)
  })
  it('treats empty-word text and spaced text as usable, gapless text as not', () => {
    assert.equal(streamIsUsable(''), true)
    assert.equal(streamIsUsable('   \n'), true)
    assert.equal(streamIsUsable('React and Node'), true)
    assert.equal(streamIsUsable('React,ReactNative,TailwindCSS,Vite,Redux'), false)
  })
})

describe('checkLigatures', () => {
  it('fails only the engine that contains a ligature glyph', () => {
    const r = checkLigatures([engine('a', 'o\uFB01ce'), engine('b', 'office')])
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('FAIL a')))
    assert.ok(r.lines.some((l) => l.includes('ok   b')))
  })
})

describe('checkInvisibleChars', () => {
  it('reports only FAIL lines when every engine errored', () => {
    const r = checkInvisibleChars([
      engine('a', '<error Boom: x>'),
      engine('b', '<error Timeout: y>'),
    ])
    assert.equal(r.failures, 2)
    assert.equal(r.lines.length, 2)
    assert.ok(
      r.lines.every((l) => l.startsWith('FAIL ')),
      r.lines.join('\n'),
    )
    assert.ok(!r.lines.some((l) => l.startsWith('ok')))
  })
  it('fails when there are no engines at all', () => {
    const r = checkInvisibleChars([])
    assert.equal(r.failures, 1)
    assert.deepEqual(r.lines, ['FAIL no engine produced text to scan'])
  })
  it('fails on nbsp', () => {
    const r = checkInvisibleChars([engine('a', 'a\u00a0b')])
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('FAIL nbsp')))
  })
  it('fails on soft hyphen', () => {
    const r = checkInvisibleChars([engine('a', 'co\u00adop')])
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('FAIL soft hyphen')))
  })
  it('names the engine that holds the invisible character', () => {
    const r = checkInvisibleChars([engine('clean', CLEAN), engine('dirty', 'co\u00ADop')])
    assert.equal(r.failures, 1)
    assert.ok(
      r.lines.some(
        (l) => l.includes('FAIL soft hyphen') && l.includes('dirty') && !l.includes('clean'),
      ),
    )
    const n = checkInvisibleChars([engine('clean', CLEAN), engine('dirty', 'a\u00A0b')])
    assert.ok(
      n.lines.some((l) => l.includes('FAIL nbsp') && l.includes('dirty') && !l.includes('clean')),
    )
  })
  it('passes clean text', () => {
    assert.equal(checkInvisibleChars([engine('a', CLEAN)]).failures, 0)
  })
})

describe('checkHeadings', () => {
  it('passes when headings are present', () => {
    assert.equal(checkHeadings([engine('a', CLEAN)], ['SUMMARY']).failures, 0)
  })
  it('fails a letter-spaced heading', () => {
    const r = checkHeadings([engine('a', 'P R O F I L E\nSUMMARY')], ['SUMMARY'])
    assert.equal(r.failures, 1)
  })
  it('fails a missing heading', () => {
    const r = checkHeadings([engine('a', CLEAN)], ['PROJECTS'])
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('PROJECTS')))
  })
  it('skips a gapless stream-order engine', () => {
    const r = checkHeadings([engine('raw', 'React,ReactNative,Vite,Redux', true)], ['SUMMARY'])
    assert.equal(r.failures, 0)
    assert.ok(r.lines.some((l) => l.includes('skip raw')))
  })
  it('fails a gapless engine that is not stream-order', () => {
    const r = checkHeadings([engine('pdf.js', 'React,ReactNative,Vite,Redux')], ['SUMMARY'])
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('FAIL pdf.js') && l.includes('no word gaps')))
  })
})

describe('checkStreamGaps', () => {
  const spaced = 'React and Node work with the team on a large product'
  const positional = [engine('a', spaced), engine('b', spaced)]

  it('passes a stream-order engine with as many spaces as the others', () => {
    const r = checkStreamGaps([...positional, engine('raw', spaced, true)])
    assert.equal(r.failures, 0)
    assert.match(r.lines[0], /^ok {3}word gaps: raw has 1\.00x/)
  })
  it('fails a stream-order engine that lost its word gaps while the others kept them', () => {
    const r = checkStreamGaps([
      ...positional,
      engine('raw', 'React,ReactNative,TypeScriptNodejsAndTheTeam', true),
    ])
    assert.equal(r.failures, 1)
    assert.match(
      r.lines[0],
      /^FAIL raw: word gaps lost: 0\.0\d\d spaces\/char against 0\.\d+ in the positional engines$/,
    )
  })
  it('compares against the least spaced usable positional engine', () => {
    // 0.5x of 0.1 is 0.05: the raw text at 0.06 passes, 0.04 fails.
    const sparse = `${'a'.repeat(9)} `.repeat(10)
    const near = `${'a'.repeat(15)} `.repeat(6)
    const far = `${'a'.repeat(24)} `.repeat(4)
    assert.equal(
      checkStreamGaps([engine('a', spaced), engine('b', sparse), engine('raw', near, true)])
        .failures,
      0,
    )
    assert.equal(
      checkStreamGaps([engine('a', spaced), engine('b', sparse), engine('raw', far, true)])
        .failures,
      1,
    )
  })
  it('says nothing when no positional engine has usable text to compare with', () => {
    assert.deepEqual(checkStreamGaps([engine('a', '<error X: y>'), engine('raw', 'abc', true)]), {
      failures: 0,
      lines: [],
    })
    assert.deepEqual(checkStreamGaps([engine('a', 'abcdefghij'), engine('raw', 'abc', true)]), {
      failures: 0,
      lines: [],
    })
  })
  it('leaves an errored stream-order engine to the checks that report errors', () => {
    assert.deepEqual(checkStreamGaps([...positional, engine('raw', '<error X: y>', true)]), {
      failures: 0,
      lines: [],
    })
  })
})

describe('checkKeywords', () => {
  const three = [engine('a', CLEAN), engine('b', CLEAN), engine('c', CLEAN)]
  it('passes when every engine has every keyword', () => {
    assert.equal(checkKeywords(three, ['react', 'Node']).failures, 0)
  })
  it('matches a keyword wrapped across a newline', () => {
    const wrapped = three.map((e) => ({
      ...e,
      text: 'Senior React\nNative developer for mobile apps',
    }))
    assert.equal(checkKeywords(wrapped, ['React Native']).failures, 0)
  })
  it('skips gapless text only for the stream-order engine', () => {
    const gapless = 'React,ReactNative,TailwindCSS,Vite,Redux'
    const skipped = checkKeywords([...three, engine('raw', gapless, true)], ['React'])
    assert.equal(skipped.failures, 0)
    assert.ok(skipped.lines.some((l) => l.includes('skip raw')))
    const failed = checkKeywords([...three, engine('pdf.js', gapless, false)], ['React'])
    assert.equal(failed.failures, 1)
    assert.ok(failed.lines.some((l) => l.includes('FAIL pdf.js') && l.includes('no word gaps')))
  })
  it('fails when fewer than 3 engines have matchable text', () => {
    const r = checkKeywords([engine('a', CLEAN), engine('b', CLEAN)], ['React'])
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('only 2 engine(s)')))
  })
  it('does not count a skipped stream-order engine as matchable', () => {
    const gapless = 'React,ReactNative,TailwindCSS,Vite,Redux'
    const r = checkKeywords(
      [engine('a', CLEAN), engine('b', CLEAN), engine('raw', gapless, true)],
      ['React'],
    )
    assert.equal(r.failures, 1)
    assert.ok(r.lines.some((l) => l.includes('only 2 engine(s)')))
  })
  it('does not count a gapless non-stream engine as matchable', () => {
    const gapless = 'React,ReactNative,TailwindCSS,Vite,Redux'
    const r = checkKeywords(
      [engine('a', CLEAN), engine('b', CLEAN), engine('pdf.js', gapless)],
      ['React'],
    )
    assert.equal(r.failures, 2)
    assert.ok(r.lines.some((l) => l.includes('FAIL pdf.js') && l.includes('no word gaps')))
    assert.ok(r.lines.some((l) => l.includes('only 2 engine(s)')))
  })
  it('fails an engine missing a keyword', () => {
    const r = checkKeywords([...three, engine('d', 'nothing here')], ['React'])
    assert.equal(r.failures, 1)
  })
})

describe('an engine that failed to extract', () => {
  const broken = engine('pdf.js', '<error Error: bad xref>')
  const good = engine('poppler', CLEAN)
  const reason = (lines: string[]): boolean =>
    lines.some((l) => l.startsWith('FAIL pdf.js: extraction error:') && l.includes('bad xref'))

  it('fails check [1] once, with the reason, and not as ok', () => {
    const r = checkLigatures([good, broken])
    assert.equal(r.failures, 1)
    assert.ok(reason(r.lines))
    assert.ok(!r.lines.some((l) => l.startsWith('ok   pdf.js')))
  })
  it('fails check [2] once per errored engine, not once per character class', () => {
    const r = checkInvisibleChars([good, broken])
    assert.equal(r.failures, 1)
    assert.ok(reason(r.lines))
    assert.ok(!r.lines.some((l) => l.startsWith('ok   no ') && l.includes('pdf.js')))
  })
  it('fails check [3] once, with the reason rather than a missing-heading list', () => {
    const r = checkHeadings([good, broken], ['SUMMARY'])
    assert.equal(r.failures, 1)
    assert.ok(reason(r.lines))
    assert.ok(!r.lines.some((l) => l.includes('pdf.js') && l.includes('missing=')))
  })
  it('fails check [4] once, with the reason, and does not count it as matchable', () => {
    const engines = [good, engine('a', CLEAN), engine('b', CLEAN), broken]
    const r = checkKeywords(engines, ['React'])
    assert.equal(r.failures, 1)
    assert.ok(reason(r.lines))
    assert.ok(!r.lines.some((l) => l.includes('pdf.js') && l.includes('missing [')))
    // Two good engines plus the errored one is below the matchable minimum.
    const few = checkKeywords([good, engine('a', CLEAN), broken], ['React'])
    assert.equal(few.failures, 2)
  })
  it('adds one failure per errored engine', () => {
    const r = checkLigatures([engine('a', '<error x>'), engine('b', '<error y>')])
    assert.equal(r.failures, 2)
  })
})
