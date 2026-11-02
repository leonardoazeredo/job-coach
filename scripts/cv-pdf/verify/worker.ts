import { parentPort, workerData } from 'node:worker_threads'
import { mupdfTextInProcess, pdfjsTextInProcess } from './extractors.ts'
import { glyphSizesInProcess, linkTargetsInProcess } from './glyphs.ts'
import type { WorkerTask } from './runInWorker.ts'

function run(task: WorkerTask, pdf: string): Promise<unknown> {
  switch (task) {
    case 'pdfjsText':
      return pdfjsTextInProcess(pdf)
    case 'mupdfText':
      return mupdfTextInProcess(pdf)
    case 'glyphSizes':
      return glyphSizesInProcess(pdf)
    case 'linkTargets':
      return linkTargetsInProcess(pdf)
  }
}

// Both ends of this message protocol live in this folder (see runInWorker.ts).
// biome-ignore lint/nursery/noUnsafeTypeAssertion: workerData is set by runInWorker.ts with exactly this shape
const { task, pdf } = workerData as { task: WorkerTask; pdf: string }
if (parentPort === null) throw new Error('worker.ts must run as a worker thread')
const port = parentPort
try {
  port.postMessage({ ok: true, value: await run(task, pdf) })
} catch (e) {
  const err = e instanceof Error ? e : new Error(String(e))
  port.postMessage({ ok: false, name: err.name, message: err.message })
}
