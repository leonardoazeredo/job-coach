import { describe, expect, it } from 'vitest'
import { ask, type BoardDeps, pages } from '../lib/boards/pull-loop.ts'
import { fakeFetch, json } from './board-fakes.ts'

const URL_ = 'https://board.test/page'

// Sleeps are recorded, not waited, so the pacing is read from what was asked for.
const deps = (fetch: BoardDeps['fetch']) => {
  const waits: number[] = []
  const sleep = async (ms: number) => {
    waits.push(ms)
  }
  return { deps: { fetch, sleep } satisfies BoardDeps, waits }
}

const readJson = async (r: Response): Promise<unknown> => r.json()
const readCount = async (r: Response): Promise<number> => {
  const body: { n: number } = await r.json()
  return body.n
}

describe('ask', () => {
  it('asks again when the answer is undefined, then takes the answer', async () => {
    let n = 0
    const { fetch, urls } = fakeFetch(() => json({ n: ++n }))
    const { deps: d } = deps(fetch)
    const answer = await ask(d, 'Test', {
      url: URL_,
      read: async (r) => {
        const n = await readCount(r)
        return n < 2 ? undefined : { n }
      },
    })
    expect(answer).toEqual({ n: 2 })
    expect(urls).toHaveLength(2)
  })

  it('asks again when the fetch throws, then takes the answer', async () => {
    let n = 0
    const fetch = async () => {
      if (++n === 1) throw new Error('connection dropped')
      return json({ ok: true })
    }
    const { deps: d } = deps(fetch)
    expect(await ask(d, 'Test', { url: URL_, read: readJson })).toEqual({ ok: true })
    expect(n).toBe(2)
  })

  it('asks again when read throws', async () => {
    const { fetch, urls } = fakeFetch(() => json({}))
    const { deps: d } = deps(fetch)
    let n = 0
    const answer = await ask(d, 'Test', {
      url: URL_,
      read: () => {
        if (++n === 1) throw new Error('not JSON')
        return 'fine'
      },
    })
    expect(answer).toBe('fine')
    expect(urls).toHaveLength(2)
  })

  it('throws after four failures with the board and the URL in the message', async () => {
    const { fetch, urls } = fakeFetch(() => json({}))
    const { deps: d } = deps(fetch)
    await expect(ask(d, 'WhatRuns', { url: URL_, read: () => undefined })).rejects.toThrow(
      `WhatRuns failed 4 times: ${URL_}`,
    )
    expect(urls).toHaveLength(4)
  })

  it('waits 1500, 3000 and 4500 ms between attempts and not after the last', async () => {
    const { fetch } = fakeFetch(() => json({}))
    const { deps: d, waits } = deps(fetch)
    await expect(ask(d, 'Test', { url: URL_, read: () => undefined })).rejects.toThrow()
    expect(waits).toEqual([1500, 3000, 4500])
  })

  it('does not wait when the first attempt answers', async () => {
    const { fetch } = fakeFetch(() => json({}))
    const { deps: d, waits } = deps(fetch)
    await ask(d, 'Test', { url: URL_, read: readJson })
    expect(waits).toEqual([])
  })

  it('asks once for any answer read returns, even one that looks like an error', async () => {
    const { fetch, urls } = fakeFetch(() => new Response('gone', { status: 500 }))
    const { deps: d, waits } = deps(fetch)
    const answer = await ask(d, 'Test', { url: URL_, read: (r) => ({ status: r.status }) })
    expect(answer).toEqual({ status: 500 })
    expect(urls).toHaveLength(1)
    expect(waits).toEqual([])
  })

  it('passes headers to fetch when given', async () => {
    const seen: unknown[][] = []
    const fetch = async (...args: unknown[]) => {
      seen.push(args)
      return json({})
    }
    const { deps: d } = deps(fetch)
    await ask(d, 'Test', { url: URL_, read: readJson, headers: { 'user-agent': 'coach' } })
    expect(seen).toEqual([[URL_, { headers: { 'user-agent': 'coach' } }]])
  })

  it('calls fetch with the URL only when no headers are given', async () => {
    const seen: unknown[][] = []
    const fetch = async (...args: unknown[]) => {
      seen.push(args)
      return json({})
    }
    const { deps: d } = deps(fetch)
    await ask(d, 'Test', { url: URL_, read: readJson })
    expect(seen).toEqual([[URL_]])
  })
})

describe('pages', () => {
  const urlOf = (page: number) => `${URL_}?page=${page}`

  it('yields each answer with its page number, in order, asking for each page URL', async () => {
    const { fetch, urls } = fakeFetch((u) => json({ p: u.searchParams.get('page') }))
    const { deps: d } = deps(fetch)
    const got: unknown[] = []
    for await (const { page, answer } of pages(d, 'Test', { urlOf, read: readJson })) {
      got.push({ page, answer })
      if (page === 3) break
    }
    expect(got).toEqual([
      { page: 1, answer: { p: '1' } },
      { page: 2, answer: { p: '2' } },
      { page: 3, answer: { p: '3' } },
    ])
    expect(urls.map((u) => u.href)).toEqual([urlOf(1), urlOf(2), urlOf(3)])
  })

  it('pauses 200 ms before each page after the first and not before the first', async () => {
    const { fetch } = fakeFetch(() => json({}))
    const { deps: d, waits } = deps(fetch)
    const order: string[] = []
    const logged: BoardDeps = {
      fetch: async (url) => {
        order.push('fetch')
        return fetch(url)
      },
      sleep: async (ms) => {
        order.push(`sleep ${ms}`)
        await d.sleep(ms)
      },
    }
    for await (const { page } of pages(logged, 'Test', { urlOf, read: readJson }))
      if (page === 3) break
    expect(waits).toEqual([200, 200])
    expect(order).toEqual(['fetch', 'sleep 200', 'fetch', 'sleep 200', 'fetch'])
  })

  it('makes no pause or request once the consumer breaks', async () => {
    const { fetch, urls } = fakeFetch(() => json({}))
    const { deps: d, waits } = deps(fetch)
    for await (const _ of pages(d, 'Test', { urlOf, read: readJson })) break
    expect(waits).toEqual([])
    expect(urls).toHaveLength(1)
  })

  it('retries a page through ask before moving on', async () => {
    let n = 0
    const { fetch } = fakeFetch(() => json({ n: ++n }))
    const { deps: d, waits } = deps(fetch)
    const read = async (r: Response) => {
      const n = await readCount(r)
      return n === 1 ? undefined : { n }
    }
    for await (const { answer } of pages(d, 'Test', { urlOf, read: read })) {
      expect(answer).toEqual({ n: 2 })
      break
    }
    expect(waits).toEqual([1500])
  })
})
