// The loop every board shares, as far as the boards agree: the retry of one request and the
// pacing between the pages of one run. It goes no further than a run of pages because that is
// where the boards part: each decides for itself when to stop, what counts as a duplicate and
// what to print, so those stay in the adapters and the loop neither stops nor logs.

// What a board is given from outside, passed in so a test can run a pull against
// recorded pages with no network and no waiting.
export type BoardDeps = {
  fetch: (url: string, init?: { headers: Record<string, string> }) => Promise<Response>
  sleep: (ms: number) => Promise<void>
  log?: (line: string) => void
}

const ATTEMPTS = 4
const RETRY_MS = 1500
// Pace between pages so a board is not hit in a burst.
const PAUSE_MS = 200

type Read<T> = (response: Response) => T | undefined | Promise<T | undefined>

// `read` decides what is worth another attempt: undefined, or a throw from fetch or read, is asked
// again; any other value is final, so a board can hand back an HTTP error as an answer that a
// retry would not change.
export const ask = async <T>(
  { fetch, sleep }: BoardDeps,
  board: string,
  { url, read, headers }: { url: string; read: Read<T>; headers?: Record<string, string> },
): Promise<T> => {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const answer = await (headers ? fetch(url, { headers }) : fetch(url))
      .then(read)
      .catch(() => undefined)
    if (answer !== undefined) return answer
    if (attempt < ATTEMPTS) await sleep(RETRY_MS * attempt)
  }
  throw new Error(`${board} failed ${ATTEMPTS} times: ${url}`)
}

// Never ends by itself: the adapter breaks on its own stop rule. The pause comes before a page,
// not after, so none is made once the consumer has stopped.
export async function* pages<T>(
  deps: BoardDeps,
  board: string,
  {
    urlOf,
    ...rest
  }: { urlOf: (page: number) => string; read: Read<T>; headers?: Record<string, string> },
): AsyncGenerator<{ page: number; answer: T }, never> {
  for (let page = 1; ; page++) {
    if (page > 1) await deps.sleep(PAUSE_MS)
    yield { page, answer: await ask(deps, board, { url: urlOf(page), ...rest }) }
  }
}
