// The CV PDF export: CV data and keywords in, a printed and verified PDF out.
//
// Chrome's Print / Save-as-PDF and `--print-to-pdf` are the same engine, so this gives
// the PDF the browser would, without a dialog. The text layer is what an ATS reads.
//
// Flow: build -> serve -> print -> check the page count against the app's fit -> verify.
// A PDF that renders is not the same as a PDF that parses, and the verifier is the only
// step that can tell them apart, so it is never skipped.
//
// The run's order, the fit-versus-PDF check, the verifier and the report lines live here
// and run under any `ExportTools`; only the page printer and the PDF reader touch Chrome,
// Vite or poppler.
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CvData } from '../lib/cv-schema.ts'
import { EXIT } from '../lib/problem.ts'
import { expectations } from './verify/expectations.ts'
import { type PdfReader, realPdfReader } from './verify/reader.ts'
import { verifyPdf } from './verify/run.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

// Thrown for any reason the PDF must not be sent; the message is for the user. The code
// is the exit status the command ends with, so the entry point does not guess it.
export class ExportError extends Error {
  readonly code: number
  constructor(message: string, code: number = EXIT.problems) {
    super(message)
    this.code = code
  }
}

export type PrintResult = {
  // Page count the page itself fitted to; undefined when the page did not report one.
  fittedPages: number | undefined
  mounted: boolean
}

// Prints a CV to `out`. ExportError carries the reason the user can act on; other failures (the Vite build, temp
// directory) throw plain Errors. `log` receives the
// build, serve, mount and print lines, which happen inside the printer.
export interface PagePrinter {
  print(cv: CvData, out: string, log: (line: string) => void): Promise<PrintResult>
}

export type ExportTools = { printer: PagePrinter; reader: PdfReader }

export type ExportRun = {
  cv: CvData
  // Ad keywords that must survive text extraction, on top of the CV's skills.
  keywords: string[]
  pdf: string
  log: (line: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// chrome-headless-shell is always headless and rejects --headless=new.
const headlessFlags = (chrome: string): string[] => {
  const base = ['--disable-gpu', '--no-sandbox', '--disable-breakpad']
  return chrome.includes('chrome-headless-shell') ? base : ['--headless=new', ...base]
}

const waitForServer = async (url: string, timeoutMs = 30000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return true
    } catch {
      // not listening yet
    }
    await sleep(200)
  }
  return false
}

// Asynchronous because the preview server lives in this process: blocking the event loop
// while Chrome waits for the page would deadlock both.
const dumpDom = async (chrome: string, url: string): Promise<string> => {
  // A throwaway profile keeps Chrome from handing the URL to a browser that is already
  // open, which would print nothing here.
  const profile = mkdtempSync(join(tmpdir(), 'cv-dom-'))
  try {
    const flags = [
      ...headlessFlags(chrome),
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=5000',
      '--dump-dom',
      url,
    ]
    // A timeout or crash is not an error here: the callback resolves with whatever Chrome
    // had written, and the mount check is advisory, so a failed dump reads as "not mounted".
    return await new Promise<string>((done) =>
      execFile(chrome, flags, { timeout: 25000, maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) =>
        done(stdout),
      ),
    )
  } finally {
    // Chrome's helper processes can still be writing into the profile as it exits.
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

// Chrome does not exit cleanly after --print-to-pdf, so the file is polled for instead.
const printToPdf = async (chrome: string, url: string, out: string): Promise<number> => {
  const profile = mkdtempSync(join(tmpdir(), 'cv-pdf-'))
  const child = spawn(
    chrome,
    [
      ...headlessFlags(chrome),
      '--disable-crash-reporter',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      // lets the deferred module script fetch, run and mount React
      '--virtual-time-budget=6000',
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${out}`,
      url,
    ],
    { stdio: 'ignore', detached: true },
  )
  // An unlaunchable binary reports through 'error', which would otherwise be thrown unhandled.
  let startError: Error | undefined
  child.on('error', (e) => {
    startError = e
  })

  const deadline = Date.now() + 60000
  let size = 0
  while (!startError && Date.now() < deadline) {
    try {
      size = statSync(out).size
      if (size > 0) break
    } catch {
      // not written yet
    }
    await sleep(250)
  }

  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
  rmSync(profile, { recursive: true, force: true })

  if (startError) throw new ExportError(`could not start Chrome (${startError.message})`)
  if (!size) throw new ExportError('Chrome did not write a PDF within 60s')
  return size
}

// Vite is loaded here so that importing this module (for its types or the CLI parsing)
// does not pay for it.
const buildAndServe = async (outDir: string, cv: CvData) => {
  const [{ build, preview }, { default: react }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
  ])
  const shared = {
    root: HERE,
    configFile: false,
    logLevel: 'warn',
    // relative asset URLs so the build works from any base path
    base: './',
    build: { outDir, emptyOutDir: true },
  } as const
  await build({ ...shared, plugins: [react()] })
  // The validated copy, not the raw file: the page trusts this shape without checking it.
  writeFileSync(join(outDir, 'cv.json'), JSON.stringify(cv))
  const server = await preview({
    ...shared,
    // localhost, not 127.0.0.1: vite preview can bind [::1] only
    preview: { host: 'localhost', port: 0 },
  })
  // vite's reported localhost URL may not reach the [::1] socket it binds, so the URL
  // names the bound address.
  const addr = server.httpServer.address()
  const url =
    addr && typeof addr === 'object'
      ? `http://${addr.family === 'IPv6' ? `[${addr.address}]` : addr.address}:${addr.port}/`
      : undefined
  if (!url) {
    await server.close()
    throw new ExportError('the preview server did not report an address')
  }
  return { url, close: () => server.close() }
}

// The real page printer: the Vite build, the preview server and Chrome together.
export const chromePagePrinter = (chrome: string): PagePrinter => ({
  async print(cv, out, log) {
    log(`  browser: ${chrome.split('/').at(-1)}`)
    log(`  output:  ${out}`)
    const work = mkdtempSync(join(tmpdir(), 'cv-pdf-build-'))
    try {
      log('  [1/4] building')
      const site = await buildAndServe(work, cv)
      try {
        log(`  [2/4] serving the build on ${site.url}`)
        if (!(await waitForServer(site.url))) {
          throw new ExportError(`preview server never answered on ${site.url}`)
        }
        const dom = await dumpDom(chrome, site.url)
        const fitted = /data-fit-pages="(\d+)"/.exec(dom)?.[1]
        // The mount check is advisory: a browser whose --dump-dom cannot see the hydrated DOM
        // would otherwise block a print that works.
        const mounted = dom.includes('class="cv"')
        log(
          mounted
            ? '        app mounted'
            : '        could not confirm the mount; printing anyway and letting the verifier decide',
        )

        log('  [3/4] printing to PDF')
        rmSync(out, { force: true })
        const size = await printToPdf(chrome, site.url, out)
        log(`        wrote ${(size / 1024).toFixed(0)} KB`)
        return { fittedPages: fitted === undefined ? undefined : Number(fitted), mounted }
      } finally {
        await site.close()
      }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  },
})

export const realExportTools = (chrome: string): ExportTools => ({
  printer: chromePagePrinter(chrome),
  reader: realPdfReader,
})

// Resolves when the PDF is printed, matches the page count the page reported (when it
// reports one), and passes the verifier. Throws ExportError when the PDF must not be sent. A
// failed page count read propagates unchanged and the verifier counts other reader failures as
// failed checks; the entry point reports PopplerMissingError with the missing-tool exit code.
export const runExport = async (tools: ExportTools, run: ExportRun): Promise<void> => {
  const { cv, keywords, log } = run
  const out = resolve(run.pdf)
  const { fittedPages, mounted } = await tools.printer.print(cv, out, log)

  // The fit is computed in the browser and the PDF is printed by another process; a
  // mismatch means the preview lied about what would print. The reader throws when it
  // fails, so a broken reader stops the export instead of skipping this check.
  const printed = String((await tools.reader.info(out)).pages)
  // A fit the page does report always has to match the PDF; the mount only decides
  // whether a missing fit is an error.
  if (fittedPages === undefined) {
    if (mounted) {
      throw new ExportError(
        'the page mounted but reported no fit (data-fit-pages missing): the fit did not run. Do not send it.',
      )
    }
    log('        fit: not reported by the page; page agreement not checked')
  } else if (String(fittedPages) !== printed) {
    throw new ExportError(
      `the preview fitted ${fittedPages} page(s) but the PDF has ${printed}. Do not send it.`,
    )
  } else {
    log(`        fit: ${fittedPages} page(s), matches the PDF`)
  }

  log('  [4/4] verifying the text layer\n')
  const failures = await verifyPdf(out, expectations(cv, keywords), tools.reader, log)
  if (failures > 0) {
    throw new ExportError('the PDF was written but failed verification. Do not send it.')
  }
  log(`  Done: ${out}`)
}
