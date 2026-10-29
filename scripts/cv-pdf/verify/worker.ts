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

const { task, pdf } = workerData as { task: WorkerTask; pdf: string }
try {
  parentPort!.postMessage({ ok: true, value: await run(task, pdf) })
} catch (e) {
  const err = e instanceof Error ? e : new Error(String(e))
  parentPort!.postMessage({ ok: false, name: err.name, message: err.message })
}
