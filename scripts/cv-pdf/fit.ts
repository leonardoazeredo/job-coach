/**
 * Page-fit policy and its presentation helpers. Pure functions, no DOM: the
 * caller measures the rendered document at each level and this module decides
 * which level to keep. There are three policies. The automatic one (chooseFit)
 * keeps body text inside the MIN_PT..MAX_PT band. The one-page one
 * (chooseOnePageFit) starts from that result and goes under the band, as far
 * as ONE_PAGE_MIN_PT, only when the automatic result is more than one page.
 * The two-page one (chooseTwoPageFit) also leaves a one-page result alone;
 * otherwise it takes the largest band level with two pages or fewer, and goes
 * under the band, to the same floor, only when every band level needs a third.
 */

export interface FitLevel {
  fontPt: number
  leading: number
  gap: number
}
export interface PageMeasure {
  pages: number
  /** 0..1 of the last page's content height */
  lastFill: number
}
export type FitMode = 'auto' | 'one-page' | 'two-pages'
export type FitStatus = 'one-page' | 'balanced' | 'sparse' | 'stub' | 'squeezed'
export interface FitResult extends PageMeasure {
  index: number
  level: FitLevel
  status: FitStatus
  /** set to the fit mode's page target when no size down to ONE_PAGE_MIN_PT
   *  reached it; the other fields are then the automatic fit's */
  missedPages?: 1 | 2
}
export interface RectLike {
  left: number
  bottom: number
  width: number
  height: number
}

export const MIN_PT = 10
export const MAX_PT = 12
/** 11pt: the multi-page tie-break prefers the level closest to this */
export const NOMINAL_INDEX = 8
export const MIN_LAST_FILL = 0.5

const STEPS = 16

const levelAt = (t: number): FitLevel => ({
  fontPt: MIN_PT + (MAX_PT - MIN_PT) * t,
  leading: 1.1 + 0.25 * t,
  gap: 0.8 + 0.6 * t,
})

export const FIT_LEVELS: readonly FitLevel[] = Array.from({ length: STEPS + 1 }, (_, i) =>
  levelAt(i / STEPS),
)

const TIGHTEST = levelAt(0)

/** floor of both page-target modes, not only one-page */
export const ONE_PAGE_MIN_PT = 9

const COMPACT_STEPS = 8

/** Under the band, smallest first: squeezeTo takes the last level within its
 *  page target as the largest. COMPACT_STEPS keeps the step equal to FIT_LEVELS',
 *  which the negative index of a squeezed result relies on. Line height and
 *  gap stay at the band's tightest. */
export const COMPACT_LEVELS: readonly FitLevel[] = Array.from(
  { length: COMPACT_STEPS },
  (_, i) => ({
    fontPt: ONE_PAGE_MIN_PT + ((MIN_PT - ONE_PAGE_MIN_PT) * i) / COMPACT_STEPS,
    leading: TIGHTEST.leading,
    gap: TIGHTEST.gap,
  }),
)

interface Row extends PageMeasure {
  index: number
  level: FitLevel
}

const measureAll = (
  levels: readonly FitLevel[],
  measure: (level: FitLevel, index: number) => PageMeasure,
): Row[] => levels.map((level, index) => ({ index, level, ...measure(level, index) }))

const toResult = (row: Row, status: FitStatus): FitResult => ({
  index: row.index,
  level: row.level,
  pages: row.pages,
  lastFill: row.lastFill,
  status,
})

function onePageChoice(rows: readonly Row[]): FitResult | undefined {
  const best = rows.filter((r) => r.pages === 1).at(-1)
  return best && toResult(best, best.lastFill < MIN_LAST_FILL ? 'sparse' : 'one-page')
}

/** The fewest pages whose last page is full enough; among its levels, the one
 *  closest to nominalIndex. */
function balancedChoice(rows: readonly Row[], nominalIndex: number): FitResult | undefined {
  const pageCounts = rows.map((r) => r.pages)
  const maxPages = Math.max(...pageCounts)
  for (let n = Math.min(...pageCounts); n <= maxPages; n++) {
    const pool = rows.filter((r) => r.pages === n && r.lastFill >= MIN_LAST_FILL)
    if (pool.length === 0) continue
    const best = pool.reduce((cur, r) => {
      const d = Math.abs(r.index - nominalIndex)
      const cd = Math.abs(cur.index - nominalIndex)
      // equidistant levels: take the larger text, which reads better
      return d < cd || (d === cd && r.index > cur.index) ? r : cur
    })
    return toResult(best, 'balanced')
  }
  return undefined
}

function stubChoice(rows: readonly Row[]): FitResult {
  const minPages = Math.min(...rows.map((r) => r.pages))
  const best = rows
    .filter((r) => r.pages === minPages)
    .reduce((cur, r) => (r.lastFill >= cur.lastFill ? r : cur))
  return toResult(best, 'stub')
}

export function chooseFit(
  levels: readonly FitLevel[],
  measure: (level: FitLevel, index: number) => PageMeasure,
  nominalIndex: number = NOMINAL_INDEX,
): FitResult {
  // every level is measured: last-page fill is not monotonic in font size
  // (whole jobs jump pages), so a bisection could settle on a worse level
  const rows = measureAll(levels, measure)
  if (rows.length === 0) throw new Error('chooseFit needs at least one level')
  return onePageChoice(rows) ?? balancedChoice(rows, nominalIndex) ?? stubChoice(rows)
}

/** The pass under the band that the page-target modes share: the largest
 *  compact level that gives `target` pages or fewer, else the automatic fit
 *  flagged as a miss. */
function squeezeTo(
  target: 1 | 2,
  auto: FitResult,
  compact: readonly FitLevel[],
  measure: (level: FitLevel, index: number) => PageMeasure,
): FitResult {
  // every level, as in chooseFit: jobs move to the next page whole, so page
  // count is not assumed to be monotonic in font size and a bisection, or
  // stopping at the first level that overflows, could miss the largest
  // level that fits
  const rows = measureAll(compact, measure)
  const best = rows.filter((r) => r.pages <= target).at(-1)
  if (!best) return { ...auto, missedPages: target }
  return {
    ...toResult(best, 'squeezed'),
    // negative so it can never collide with a FIT_LEVELS index; offset by the
    // length so that COMPACT_LEVELS continues the FIT_LEVELS scale downwards
    // (-1 is one step under MIN_PT)
    index: best.index - compact.length,
  }
}

export function chooseOnePageFit(
  auto: FitResult,
  compact: readonly FitLevel[],
  measure: (level: FitLevel, index: number) => PageMeasure,
): FitResult {
  if (auto.pages === 1) return auto
  return squeezeTo(1, auto, compact, measure)
}

export function chooseTwoPageFit(
  auto: FitResult,
  band: readonly FitLevel[],
  compact: readonly FitLevel[],
  measure: (level: FitLevel, index: number) => PageMeasure,
): FitResult {
  // two-pages mode never stretches a CV that fits one page onto a second
  if (auto.pages === 1) return auto
  // the band is searched even when auto is more than two pages: chooseFit adds
  // a page rather than leave the last one under MIN_LAST_FILL, so two-page
  // levels can exist that it passed over
  const best = measureAll(band, measure)
    .filter((r) => r.pages <= 2)
    .at(-1)
  if (!best) return squeezeTo(2, auto, compact, measure)
  return toResult(best, best.lastFill < MIN_LAST_FILL ? 'stub' : 'balanced')
}

export function pageMeasure(
  rects: Iterable<RectLike>,
  origin: { left: number; top: number },
  colWidth: number,
  colHeight: number,
): PageMeasure {
  if (!(colWidth > 0) || !(colHeight > 0)) return { pages: 1, lastFill: 0 }
  let lastPage = 0
  let lastBottom = 0
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue
    // floor, not round: a span starting past the middle of a column would
    // otherwise count as the next page; +0.5 absorbs subpixel error at a
    // column boundary
    const page = Math.max(0, Math.floor((r.left - origin.left + 0.5) / colWidth))
    const bottom = r.bottom - origin.top
    if (page > lastPage) {
      lastPage = page
      lastBottom = bottom
    } else if (page === lastPage && bottom > lastBottom) {
      lastBottom = bottom
    }
  }
  return { pages: lastPage + 1, lastFill: lastBottom / colHeight }
}

// rounding keeps float noise (1.2250000000000001) out of the stylesheet
const num = (n: number) => String(Math.round(n * 1000) / 1000)

export function fitVars(level: FitLevel): Record<string, string> {
  return {
    '--cv-font': `${num(level.fontPt / 0.75)}px`,
    '--cv-leading': num(level.leading),
    '--cv-gap': num(level.gap),
  }
}

export function describeFit(fit: FitResult): string {
  const pt = `${Math.round(fit.level.fontPt * 10) / 10}pt`
  const pct = Math.round(fit.lastFill * 100)
  const pages = `${fit.pages} ${fit.pages === 1 ? 'page' : 'pages'}`
  if (fit.missedPages) {
    const target = fit.missedPages === 1 ? 'one page' : 'two pages'
    return `${pages} · ${pt} · does not fit ${target} at ${ONE_PAGE_MIN_PT}pt; automatic fit used`
  }
  switch (fit.status) {
    case 'one-page':
      return `${pages} · ${pt} · ${pct}% full`
    case 'balanced':
      return `${pages} · ${pt} · last page ${pct}% full`
    case 'sparse':
      return `${pages} · ${pt} · only ${pct}% full at the largest safe text size`
    case 'stub':
      return `${pages} · ${pt} · last page only ${pct}% full. Trim content to drop a page, or add more.`
    case 'squeezed':
      return `${pages} · ${pt} · ${fit.pages === 1 ? '' : 'last page '}${pct}% full · below the ${MIN_PT}pt band`
  }
}

export function fitNeedsAttention(fit: FitResult): boolean {
  // "squeezed" is not flagged: it is what a page-target mode was turned on
  // to get
  return fit.missedPages !== undefined || fit.status === 'sparse' || fit.status === 'stub'
}
