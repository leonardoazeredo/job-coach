import { Worker } from 'node:worker_threads'
import { EXTRACT_TIMEOUT_MS } from './constants.ts'

export type WorkerTask = 'pdfjsText' | 'mupdfText' | 'glyphSizes' | 'linkTargets'

export interface WorkerOptions {
  timeoutMs?: number
  /** The worker script; tests substitute one that hangs or crashes. */
  workerUrl?: URL
}

type Reply = { ok: true; value: unknown } | { ok: false; name: string; message: string }

const DEFAULT_WORKER = new URL('./worker.ts', import.meta.url)

/**
 * pdf.js and MuPDF parse synchronously in-process, so a pathological PDF would
 * hang the whole verifier. A worker thread can be terminated from outside, which
 * turns a hang or crash into a rejection.
 */
export function runInWorker<T>(
  task: WorkerTask,
  pdf: string,
  options: WorkerOptions = {},
): Promise<T> {
  const { timeoutMs = EXTRACT_TIMEOUT_MS, workerUrl = DEFAULT_WORKER } = options
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { task, pdf } })
    let settled = false
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // terminate() is what stops a worker stuck in synchronous parsing.
      void worker.terminate()
      settle()
    }
    const timer = setTimeout(
      () => finish(() => reject(new Error(`${task} timed out after ${timeoutMs / 1000}s`))),
      timeoutMs,
    )
    worker.once('message', (reply: Reply) =>
      finish(() => {
        if (reply.ok) return resolve(reply.value as T)
        const err = new Error(reply.message)
        err.name = reply.name
        reject(err)
      }),
    )
    worker.once('error', (e) =>
      finish(() =>
        reject(new Error(`${task} worker crashed: ${e instanceof Error ? e.message : String(e)}`)),
      ),
    )
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`${task} worker exited with code ${code} without a result`))),
    )
  })
}
