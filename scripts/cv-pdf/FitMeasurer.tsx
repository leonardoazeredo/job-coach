import { useLayoutEffect, useRef } from 'react'
import { CvDocument } from './CvDocument.tsx'
import {
  COMPACT_LEVELS,
  chooseFit,
  chooseOnePageFit,
  chooseTwoPageFit,
  FIT_LEVELS,
  type FitLevel,
  type FitMode,
  type FitResult,
  fitVars,
  type PageMeasure,
  pageMeasure,
} from './fit.ts'
import type { CvData } from './types.ts'

/**
 * Renders a hidden copy of the CV in a column box one page wide and tall, so
 * the number of columns it overflows into is the number of printed pages.
 * Same component and stylesheet as the visible sheet, so the measure cannot
 * drift from what prints.
 */
export function FitMeasurer({
  data,
  mode,
  onFit,
}: {
  data: CvData
  mode: FitMode
  onFit: (fit: FitResult) => void
}) {
  const box = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const wrap = box.current
    if (!wrap) return

    const setLevel = (level: FitLevel) => {
      for (const [k, v] of Object.entries(fitVars(level))) wrap.style.setProperty(k, v)
    }

    const run = () => {
      // display: none (print media) reports 0; measuring then would pick the
      // largest level just as the page prints
      if (wrap.clientWidth === 0) return
      const cv = wrap.querySelector('.cv')
      if (!cv) return
      const els = [cv, ...cv.querySelectorAll('*')]
      const origin = wrap.getBoundingClientRect()
      // two-pages mode asks again for the band levels the automatic pass has
      // just laid out. Scoped to one run: the next can follow an edit or a late
      // webfont, and either one moves line breaks. Keyed by identity: both
      // passes must be given the same FIT_LEVELS objects.
      const measured = new Map<FitLevel, PageMeasure>()
      const measure = (level: FitLevel) => {
        const known = measured.get(level)
        if (known) return known
        setLevel(level)
        const rects: DOMRect[] = []
        for (const el of els) rects.push(...el.getClientRects())
        const result = pageMeasure(rects, origin, wrap.clientWidth, wrap.clientHeight)
        measured.set(level, result)
        return result
      }
      const auto = chooseFit(FIT_LEVELS, measure)
      if (mode === 'one-page') onFit(chooseOnePageFit(auto, COMPACT_LEVELS, measure))
      else if (mode === 'two-pages')
        onFit(chooseTwoPageFit(auto, FIT_LEVELS, COMPACT_LEVELS, measure))
      else onFit(auto)
    }

    let live = true
    run()
    // a webfont arriving late changes every line break. Only when a load is
    // pending: ready is usually already resolved and would double every pass.
    if (document.fonts?.status === 'loading') {
      void document.fonts.ready.then(() => {
        if (live) run()
      })
    }
    return () => {
      live = false
    }
  }, [data, mode, onFit])

  return (
    <div className="cv-measure" aria-hidden="true" ref={box}>
      <CvDocument data={data} />
    </div>
  )
}
