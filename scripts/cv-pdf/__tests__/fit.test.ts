import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { FitResult } from '../fit.ts'
import {
  chooseFit,
  describeFit,
  FIT_LEVELS,
  fitNeedsAttention,
  fitVars,
  MAX_PT,
  MIN_PT,
  NOMINAL_INDEX,
  pageMeasure,
} from '../fit.ts'

import { fitRows, near, SEED, TEN_JOBS, TWO_JOBS } from './fit-fixtures.ts'

test('levels span the band', () => {
  assert.equal(FIT_LEVELS.length, 17)
  const first = FIT_LEVELS[0]
  const last = FIT_LEVELS[16]
  near(first.fontPt, MIN_PT)
  near(first.leading, 1.1)
  near(first.gap, 0.8)
  near(last.fontPt, 12)
  near(last.leading, 1.35)
  near(last.gap, 1.4)
  assert.equal(FIT_LEVELS[NOMINAL_INDEX].fontPt, 11)
  for (const l of FIT_LEVELS) assert.ok(l.fontPt >= MIN_PT && l.fontPt <= MAX_PT)
})

test('one page wins and is filled', () => {
  const r = fitRows(TWO_JOBS)
  assert.equal(r.index, 6)
  assert.equal(r.pages, 1)
  assert.equal(r.status, 'one-page')
})

test('content that cannot fit one page is balanced near nominal', () => {
  const r = fitRows(SEED)
  assert.equal(r.index, 8)
  assert.equal(r.pages, 2)
  assert.equal(r.status, 'balanced')
})

test('fewest pages first', () => {
  const r = fitRows(TEN_JOBS)
  assert.equal(r.index, 3)
  assert.equal(r.pages, 2)
})

test('adds a page rather than leave a stub', () => {
  const r = fitRows(
    [
      [2, 0.2],
      [2, 0.3],
      [2, 0.45],
      [3, 0.1],
      [3, 0.55],
      [3, 0.6],
    ],
    1,
  )
  assert.equal(r.index, 4)
  assert.equal(r.pages, 3)
  assert.equal(r.status, 'balanced')
})

test('tie goes to the larger text size', () => {
  assert.equal(
    fitRows(
      [
        [2, 0.6],
        [2, 0.1],
        [2, 0.1],
        [2, 0.1],
        [2, 0.6],
      ],
      2,
    ).index,
    4,
  )
})

test('stub when nothing reaches half', () => {
  const r = fitRows([
    [2, 0.1],
    [2, 0.2],
    [2, 0.4],
  ])
  assert.equal(r.index, 2)
  assert.equal(r.status, 'stub')
})

test('sparse when one page stays empty', () => {
  const r = fitRows(Array.from({ length: 17 }, () => [1, 0.3]))
  assert.equal(r.index, 16)
  assert.equal(r.status, 'sparse')
})

test('an empty document does not throw', () => {
  const r = fitRows(Array.from({ length: 17 }, () => [1, 0]))
  assert.equal(r.index, 16)
  assert.equal(r.status, 'sparse')
})

test('measures every level exactly once', () => {
  const seen: number[] = []
  chooseFit(FIT_LEVELS, (_, i) => {
    seen.push(i)
    return { pages: SEED[i][0], lastFill: SEED[i][1] }
  })
  assert.deepEqual(
    seen,
    Array.from({ length: 17 }, (_, i) => i),
  )
})

test('pageMeasure uses floor for the page', () => {
  const m = pageMeasure(
    [{ left: 400, bottom: 300, width: 50, height: 12 }],
    { left: 0, top: 0 },
    680,
    1026,
  )
  assert.equal(m.pages, 1)
})

test('pageMeasure reads the last page', () => {
  const r = (left: number, bottom: number) => ({ left, bottom, width: 10, height: 10 })
  const m = pageMeasure([r(10, 900), r(690, 200), r(1100, 513)], { left: 0, top: 0 }, 680, 1026)
  assert.equal(m.pages, 2)
  assert.equal(m.lastFill, 0.5)
})

test('pageMeasure ignores empty rects and bad sizes', () => {
  const origin = { left: 0, top: 0 }
  const empty = { left: 5000, bottom: 10, width: 0, height: 0 }
  assert.equal(pageMeasure([empty], origin, 680, 1026).pages, 1)
  assert.deepEqual(pageMeasure([], origin, 680, 1026), { pages: 1, lastFill: 0 })
  assert.deepEqual(pageMeasure([{ left: 0, bottom: 10, width: 5, height: 5 }], origin, 680, 0), {
    pages: 1,
    lastFill: 0,
  })
})

test('fitVars', () => {
  assert.deepEqual(fitVars(FIT_LEVELS[8]), {
    '--cv-font': '14.667px',
    '--cv-leading': '1.225',
    '--cv-gap': '1.1',
  })
})

test('describeFit', () => {
  const mk = (
    status: FitResult['status'],
    fontPt: number,
    lastFill: number,
    pages: number,
  ): FitResult => ({
    pages,
    lastFill,
    index: 0,
    level: { fontPt, leading: 1.2, gap: 1 },
    status,
  })
  assert.equal(describeFit(mk('one-page', 11.75, 0.996, 1)), '1 page · 11.8pt · 100% full')
  assert.equal(describeFit(mk('balanced', 11, 0.521, 2)), '2 pages · 11pt · last page 52% full')
  assert.equal(
    describeFit(mk('sparse', 12, 0.3, 1)),
    '1 page · 12pt · only 30% full at the largest safe text size',
  )
  assert.equal(
    describeFit(mk('stub', 12, 0.3, 3)),
    '3 pages · 12pt · last page only 30% full. Trim content to drop a page, or add more.',
  )
})

test('fitNeedsAttention', () => {
  const mk = (status: FitResult['status']): FitResult => ({
    pages: 1,
    lastFill: 0.5,
    index: 0,
    level: FIT_LEVELS[0],
    status,
  })
  assert.equal(fitNeedsAttention(mk('sparse')), true)
  assert.equal(fitNeedsAttention(mk('stub')), true)
  assert.equal(fitNeedsAttention(mk('one-page')), false)
  assert.equal(fitNeedsAttention(mk('balanced')), false)
})
