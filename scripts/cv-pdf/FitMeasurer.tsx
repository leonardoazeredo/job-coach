import { useLayoutEffect, useRef } from 'react'
import { CvDocument } from './CvDocument.tsx'
import {
  chooseFit,
  FIT_LEVELS,
  type FitLevel,
  type FitResult,
  fitVars,
  pageMeasure,
} from './fit.ts'
import type { CvData } from './types.ts'

/**
 * Renders a hidden copy of the CV in a column box one page wide and tall, so
 * the number of columns it overflows into is the number of printed pages.
 * Same component and stylesheet as the visible sheet, so the measure cannot
 * drift from what prints.
 */
export function FitMeasurer({ data, onFit }: { data: CvData; onFit: (fit: FitResult) => void }) {
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
      const measure = (level: FitLevel) => {
        setLevel(level)
        const rects: DOMRect[] = []
        for (const el of els) rects.push(...el.getClientRects())
        return pageMeasure(rects, origin, wrap.clientWidth, wrap.clientHeight)
      }
      onFit(chooseFit(FIT_LEVELS, measure))
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
  }, [data, onFit])

  return (
    <div className="cv-measure" aria-hidden="true" ref={box}>
      <CvDocument data={data} />
    </div>
  )
}
