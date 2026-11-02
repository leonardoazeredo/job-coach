import assert from 'node:assert/strict'
import type { FitResult } from '../fit.ts'
import {
  COMPACT_LEVELS,
  chooseFit,
  chooseOnePageFit,
  chooseTwoPageFit,
  FIT_LEVELS,
} from '../fit.ts'

// Per-level [pages, lastFill] for levels 0..16: snapshots of measurements taken
// on src/data/cv.json (SEED), its first two jobs, and its job list doubled.
// Not regenerated when the CV changes.
export const SEED = [
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
export const TWO_JOBS = [
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
export const TEN_JOBS = [
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

export function fitRows(rows: number[][], nominalIndex?: number) {
  return chooseFit(
    FIT_LEVELS.slice(0, rows.length),
    (_, i) => ({ pages: rows[i][0], lastFill: rows[i][1] }),
    nominalIndex,
  )
}

export function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !~ ${expected}`)
}

// [pages, lastFill] at 9, 9.125 ... 9.875pt on src/data/cv.json: the same kind
// of snapshot as SEED, for the levels under the band.
export const COMPACT_SEED = [
  [1, 0.956],
  [1, 0.969],
  [1, 0.982],
  [2, 0.038],
  [2, 0.039],
  [2, 0.039],
  [2, 0.04],
  [2, 0.107],
]
export const AUTO_SEED = fitRows(SEED)

export function onePage(auto: FitResult, rows: number[][]) {
  return chooseOnePageFit(auto, COMPACT_LEVELS, (_, i) => ({
    pages: rows[i][0],
    lastFill: rows[i][1],
  }))
}

// Synthetic rows, not measured snapshots like SEED: a band that needs three
// pages at every level, and one whose two-page levels chooseFit passes over.
export const THREE_PAGES = Array.from({ length: 17 }, () => [3, 0.6])
export const STUB_BAND = [
  [2, 0.2],
  [2, 0.3],
  [2, 0.45],
  [3, 0.1],
  [3, 0.55],
  [3, 0.6],
]

export function twoPages(auto: FitResult, bandRows: number[][], compactRows: number[][] = []) {
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
