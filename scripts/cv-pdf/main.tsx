import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './cv.css'
import { CvDocument } from './CvDocument.tsx'
import { FitMeasurer } from './FitMeasurer.tsx'
import type { FitResult } from './fit.ts'
import type { CvData } from './types.ts'

// The export script writes the CV beside the built page; the app has no editor or store.
const App = () => {
  const [data, setData] = useState<CvData | null>(null)
  const [fit, setFit] = useState<FitResult | null>(null)
  useEffect(() => {
    void fetch('./cv.json')
      .then((res) => res.json() as Promise<CvData>)
      .then(setData)
  }, [])
  const onFit = useCallback((next: FitResult) => setFit(next), [])
  if (!data) return null
  return (
    <>
      <div className="cv-pages">
        <CvDocument data={data} fit={fit} />
      </div>
      <FitMeasurer data={data} mode="auto" onFit={onFit} />
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
