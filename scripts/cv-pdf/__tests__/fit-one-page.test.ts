import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { FitResult } from '../fit.ts'
import {
  COMPACT_LEVELS,
  chooseOnePageFit,
  describeFit,
  FIT_LEVELS,
  fitNeedsAttention,
  fitVars,
  MIN_PT,
  ONE_PAGE_MIN_PT,
} from '../fit.ts'

import { AUTO_SEED, COMPACT_SEED, fitRows, near, onePage, TWO_JOBS } from './fit-fixtures.ts'

test('compact levels sit under the band', () => {
  assert.equal(COMPACT_LEVELS.length, 8)
  assert.deepEqual(COMPACT_LEVELS[0], { fontPt: 9, leading: 1.1, gap: 0.8 })
  near(COMPACT_LEVELS[7].fontPt, 9.875)
  for (const l of COMPACT_LEVELS) {
    assert.equal(l.leading, 1.1)
    assert.equal(l.gap, 0.8)
    assert.ok(l.fontPt >= ONE_PAGE_MIN_PT && l.fontPt < MIN_PT)
  }
  assert.deepEqual(fitVars(COMPACT_LEVELS[0]), {
    '--cv-font': '12px',
    '--cv-leading': '1.1',
    '--cv-gap': '0.8',
  })
})

test('one-page mode takes the largest compact level that fits', () => {
  const r = onePage(AUTO_SEED, COMPACT_SEED)
  assert.equal(r.index, -6)
  assert.equal(r.level.fontPt, 9.25)
  assert.equal(r.pages, 1)
  assert.equal(r.lastFill, 0.982)
  assert.equal(r.status, 'squeezed')
  assert.equal(r.missedPages, undefined)
})

test('one-page mode does not assume fit is monotonic', () => {
  const r = onePage(AUTO_SEED, [
    [1, 0.9],
    [2, 0.02],
    [1, 0.99],
    [2, 0.1],
    [2, 0.1],
    [2, 0.1],
    [2, 0.1],
    [2, 0.1],
  ])
  assert.equal(r.index, -6)
})

test('one-page mode leaves a one-page fit alone', () => {
  const auto = fitRows(TWO_JOBS)
  const r = chooseOnePageFit(auto, COMPACT_LEVELS, () => {
    throw new Error('measured a level although the automatic fit is one page')
  })
  assert.equal(r, auto)
})

test('falls back to the automatic fit when 9pt is not enough', () => {
  const r = onePage(
    AUTO_SEED,
    Array.from({ length: 8 }, () => [2, 0.4]),
  )
  assert.deepEqual(r, { ...AUTO_SEED, missedPages: 1 })
})

test('measures every compact level exactly once', () => {
  const seen: number[] = []
  chooseOnePageFit(AUTO_SEED, COMPACT_LEVELS, (_, i) => {
    seen.push(i)
    return { pages: COMPACT_SEED[i][0], lastFill: COMPACT_SEED[i][1] }
  })
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7])
})

test('describeFit in one-page mode', () => {
  const mk = (
    status: FitResult['status'],
    fontPt: number,
    lastFill: number,
    pages: number,
  ): FitResult => ({
    pages,
    lastFill,
    index: 0,
    level: { fontPt, leading: 1.1, gap: 0.8 },
    status,
  })
  assert.equal(
    describeFit(mk('squeezed', 9.25, 0.98, 1)),
    '1 page · 9.3pt · 98% full · below the 10pt band',
  )
  assert.equal(
    describeFit({ ...mk('balanced', 11, 0.521, 2), missedPages: 1 }),
    '2 pages · 11pt · does not fit one page at 9pt; automatic fit used',
  )
  assert.equal(
    describeFit({ ...mk('stub', 10, 0.3, 3), missedPages: 1 }),
    '3 pages · 10pt · does not fit one page at 9pt; automatic fit used',
  )
})

test('fitNeedsAttention in one-page mode', () => {
  const mk = (status: FitResult['status']): FitResult => ({
    pages: 1,
    lastFill: 0.5,
    index: 0,
    level: FIT_LEVELS[0],
    status,
  })
  assert.equal(fitNeedsAttention(mk('squeezed')), false)
  assert.equal(fitNeedsAttention({ ...mk('balanced'), missedPages: 1 }), true)
})
