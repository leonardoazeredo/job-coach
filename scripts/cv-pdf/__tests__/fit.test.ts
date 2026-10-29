import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { FitResult } from '../fit.ts'
import {
  COMPACT_LEVELS,
  chooseFit,
  chooseOnePageFit,
  chooseTwoPageFit,
  describeFit,
  FIT_LEVELS,
  fitNeedsAttention,
  fitVars,
  MAX_PT,
  MIN_PT,
  NOMINAL_INDEX,
  ONE_PAGE_MIN_PT,
  pageMeasure,
} from '../fit.ts'

// Per-level [pages, lastFill] for levels 0..16: snapshots of measurements taken
// on src/data/cv.json (SEED), its first two jobs, and its job list doubled.
// Not regenerated when the CV changes.
const SEED = [
  [2, 0.109],
  [2, 0.112],
  [2, 0.213],
  [2, 0.219],
  [2, 0.33],
  [2, 0.34],
  [2, 0.366],
  [2, 0.507],
  [2, 0.521],
  [2, 0.535],
  [2, 0.568],
  [2, 0.835],
  [2, 0.856],
  [2, 0.898],
  [2, 0.921],
  [2, 0.943],
  [2, 0.967],
]
const TWO_JOBS = [
  [1, 0.8],
  [1, 0.824],
  [1, 0.848],
  [1, 0.872],
  [1, 0.929],
  [1, 0.956],
  [1, 0.981],
  [2, 0.05],
  [2, 0.138],
  [2, 0.142],
  [2, 0.146],
  [2, 0.399],
  [2, 0.41],
  [2, 0.44],
  [2, 0.451],
  [2, 0.462],
  [2, 0.474],
]
const TEN_JOBS = [
  [2, 0.757],
  [2, 0.78],
  [2, 0.902],
  [2, 0.928],
  [3, 0.123],
  [3, 0.127],
  [3, 0.239],
  [3, 0.377],
  [3, 0.521],
  [3, 0.535],
  [3, 0.568],
  [3, 0.835],
  [4, 0.301],
  [4, 0.309],
  [4, 0.317],
  [4, 0.325],
  [4, 0.333],
]

function fit(rows: number[][], nominalIndex?: number) {
  return chooseFit(
    FIT_LEVELS.slice(0, rows.length),
    (_, i) => ({ pages: rows[i][0], lastFill: rows[i][1] }),
    nominalIndex,
  )
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !~ ${expected}`)
}

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
  const r = fit(TWO_JOBS)
  assert.equal(r.index, 6)
  assert.equal(r.pages, 1)
  assert.equal(r.status, 'one-page')
})

test('content that cannot fit one page is balanced near nominal', () => {
  const r = fit(SEED)
  assert.equal(r.index, 8)
  assert.equal(r.pages, 2)
  assert.equal(r.status, 'balanced')
})

test('fewest pages first', () => {
  const r = fit(TEN_JOBS)
  assert.equal(r.index, 3)
  assert.equal(r.pages, 2)
})

test('adds a page rather than leave a stub', () => {
  const r = fit(
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
    fit(
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
  const r = fit([
    [2, 0.1],
    [2, 0.2],
    [2, 0.4],
  ])
  assert.equal(r.index, 2)
  assert.equal(r.status, 'stub')
})

test('sparse when one page stays empty', () => {
  const r = fit(Array.from({ length: 17 }, () => [1, 0.3]))
  assert.equal(r.index, 16)
  assert.equal(r.status, 'sparse')
})

test('an empty document does not throw', () => {
  const r = fit(Array.from({ length: 17 }, () => [1, 0]))
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

// [pages, lastFill] at 9, 9.125 ... 9.875pt on src/data/cv.json: the same kind
// of snapshot as SEED, for the levels under the band.
const COMPACT_SEED = [
  [1, 0.956],
  [1, 0.969],
  [1, 0.982],
  [2, 0.038],
  [2, 0.039],
  [2, 0.039],
  [2, 0.04],
  [2, 0.107],
]
const AUTO_SEED = fit(SEED)

function onePage(auto: FitResult, rows: number[][]) {
  return chooseOnePageFit(auto, COMPACT_LEVELS, (_, i) => ({
    pages: rows[i][0],
    lastFill: rows[i][1],
  }))
}

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
  const auto = fit(TWO_JOBS)
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

// Synthetic rows, not measured snapshots like SEED: a band that needs three
// pages at every level, and one whose two-page levels chooseFit passes over.
const THREE_PAGES = Array.from({ length: 17 }, () => [3, 0.6])
const STUB_BAND = [
  [2, 0.2],
  [2, 0.3],
  [2, 0.45],
  [3, 0.1],
  [3, 0.55],
  [3, 0.6],
]

function twoPages(auto: FitResult, bandRows: number[][], compactRows: number[][] = []) {
  const band = FIT_LEVELS.slice(0, bandRows.length)
  const seen: string[] = []
  const result = chooseTwoPageFit(auto, band, COMPACT_LEVELS, (level, i) => {
    const inBand = band.includes(level)
    seen.push(`${inBand ? 'b' : 'c'}${i}`)
    const row = (inBand ? bandRows : compactRows)[i]
    return { pages: row[0], lastFill: row[1] }
  })
  return { result, seen }
}

test('two-pages mode fills the two pages', () => {
  const r = twoPages(fit(SEED), SEED).result
  assert.equal(r.index, 16)
  assert.equal(r.level.fontPt, 12)
  assert.equal(r.pages, 2)
  assert.equal(r.lastFill, 0.967)
  assert.equal(r.status, 'balanced')
  assert.equal(r.missedPages, undefined)
})

test('two-pages mode keeps a level that is already the largest', () => {
  const r = twoPages(fit(TEN_JOBS), TEN_JOBS).result
  assert.equal(r.index, 3)
  assert.equal(r.pages, 2)
  assert.equal(r.lastFill, 0.928)
  assert.equal(r.status, 'balanced')
})

test('two-pages mode leaves a one-page fit alone', () => {
  const auto = fit(TWO_JOBS)
  const r = chooseTwoPageFit(auto, FIT_LEVELS, COMPACT_LEVELS, () => {
    throw new Error('measured a level although the automatic fit is one page')
  })
  assert.equal(r, auto)
})

test('two-pages mode takes an in-band two-page level over a third page', () => {
  const auto = fit(STUB_BAND, 1)
  assert.equal(auto.pages, 3)
  const { result, seen } = twoPages(auto, STUB_BAND)
  assert.equal(result.index, 2)
  assert.equal(result.pages, 2)
  assert.equal(result.lastFill, 0.45)
  assert.equal(result.status, 'stub')
  assert.deepEqual(seen, ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'])
})

test('two-pages mode goes under the band only when the band needs a third page', () => {
  const { result, seen } = twoPages(fit(THREE_PAGES), THREE_PAGES, [
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
  const r = twoPages(fit(THREE_PAGES), THREE_PAGES, [
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
  const { result, seen } = twoPages(fit(rows), rows)
  assert.equal(result.index, 3)
  assert.equal(result.lastFill, 0.6)
  assert.equal(result.status, 'balanced')
  assert.deepEqual(seen, ['b0', 'b1', 'b2', 'b3', 'b4'])
})

test('falls back to the automatic fit when 9pt is not enough for two pages', () => {
  const auto = fit(THREE_PAGES)
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
