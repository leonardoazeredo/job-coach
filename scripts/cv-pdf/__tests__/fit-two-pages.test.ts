import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { FitResult } from '../fit.ts'
import {
  COMPACT_LEVELS,
  chooseTwoPageFit,
  describeFit,
  FIT_LEVELS,
  fitNeedsAttention,
} from '../fit.ts'

import {
  fitRows,
  SEED,
  STUB_BAND,
  TEN_JOBS,
  THREE_PAGES,
  TWO_JOBS,
  twoPages,
} from './fit-fixtures.ts'

test('two-pages mode fills the two pages', () => {
  const r = twoPages(fitRows(SEED), SEED).result
  assert.equal(r.index, 16)
  assert.equal(r.level.fontPt, 12)
  assert.equal(r.pages, 2)
  assert.equal(r.lastFill, 0.967)
  assert.equal(r.status, 'balanced')
  assert.equal(r.missedPages, undefined)
})

test('two-pages mode keeps a level that is already the largest', () => {
  const r = twoPages(fitRows(TEN_JOBS), TEN_JOBS).result
  assert.equal(r.index, 3)
  assert.equal(r.pages, 2)
  assert.equal(r.lastFill, 0.928)
  assert.equal(r.status, 'balanced')
})

test('two-pages mode leaves a one-page fit alone', () => {
  const auto = fitRows(TWO_JOBS)
  const r = chooseTwoPageFit(auto, FIT_LEVELS, COMPACT_LEVELS, () => {
    throw new Error('measured a level although the automatic fit is one page')
  })
  assert.equal(r, auto)
})

test('two-pages mode takes an in-band two-page level over a third page', () => {
  const auto = fitRows(STUB_BAND, 1)
  assert.equal(auto.pages, 3)
  const { result, seen } = twoPages(auto, STUB_BAND)
  assert.equal(result.index, 2)
  assert.equal(result.pages, 2)
  assert.equal(result.lastFill, 0.45)
  assert.equal(result.status, 'stub')
  assert.deepEqual(seen, ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'])
})

test('two-pages mode goes under the band only when the band needs a third page', () => {
  const { result, seen } = twoPages(fitRows(THREE_PAGES), THREE_PAGES, [
    [2, 0.9],
    [2, 0.95],
    [2, 0.99],
    [3, 0.02],
    [3, 0.02],
    [3, 0.03],
    [3, 0.03],
    [3, 0.1],
  ])
  assert.equal(result.index, -6)
  assert.equal(result.level.fontPt, 9.25)
  assert.equal(result.pages, 2)
  assert.equal(result.lastFill, 0.99)
  assert.equal(result.status, 'squeezed')
  assert.equal(result.missedPages, undefined)
  assert.deepEqual(seen, [
    ...Array.from({ length: 17 }, (_, i) => `b${i}`),
    ...Array.from({ length: 8 }, (_, i) => `c${i}`),
  ])
})

test('two-pages mode does not assume fit is monotonic', () => {
  const r = twoPages(fitRows(THREE_PAGES), THREE_PAGES, [
    [2, 0.9],
    [3, 0.02],
    [2, 0.99],
    [3, 0.1],
    [3, 0.1],
    [3, 0.1],
    [3, 0.1],
    [3, 0.1],
  ]).result
  assert.equal(r.index, -6)
})

test('two-pages mode takes the largest two-page band level, not the first run or the fullest', () => {
  const rows = [
    [3, 0.1],
    [2, 0.9],
    [3, 0.2],
    [2, 0.6],
    [3, 0.3],
  ]
  const { result, seen } = twoPages(fitRows(rows), rows)
  assert.equal(result.index, 3)
  assert.equal(result.lastFill, 0.6)
  assert.equal(result.status, 'balanced')
  assert.deepEqual(seen, ['b0', 'b1', 'b2', 'b3', 'b4'])
})

test('falls back to the automatic fit when 9pt is not enough for two pages', () => {
  const auto = fitRows(THREE_PAGES)
  const r = twoPages(
    auto,
    THREE_PAGES,
    Array.from({ length: 8 }, () => [3, 0.4]),
  ).result
  assert.deepEqual(r, { ...auto, missedPages: 2 })
})

test('describeFit in two-pages mode', () => {
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
    describeFit(mk('squeezed', 9.25, 0.98, 2)),
    '2 pages · 9.3pt · last page 98% full · below the 10pt band',
  )
  assert.equal(
    describeFit({ ...mk('balanced', 11, 0.6, 3), missedPages: 2 }),
    '3 pages · 11pt · does not fit two pages at 9pt; automatic fit used',
  )
})

test('fitNeedsAttention in two-pages mode', () => {
  const mk = (status: FitResult['status']): FitResult => ({
    pages: 2,
    lastFill: 0.9,
    index: 0,
    level: FIT_LEVELS[0],
    status,
  })
  assert.equal(fitNeedsAttention({ ...mk('balanced'), missedPages: 2 }), true)
  assert.equal(fitNeedsAttention(mk('squeezed')), false)
})
