import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { personaRules } from './temp-repo.ts'

export const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures/boards', name), 'utf8')

// Every request a board makes is answered by the route and remembered, so a test can
// check what was asked as well as what came back. Unrouted requests are a 404.
export const fakeFetch = (route: (url: URL) => Response | undefined) => {
  const urls: URL[] = []
  const fetch = async (url: string): Promise<Response> => {
    const u = new URL(url)
    urls.push(u)
    return route(u) ?? new Response('not found', { status: 404 })
  }
  return { fetch, urls }
}
export const sleep = () => Promise.resolve()
export const search = personaRules().discovery.search
export const json = (body: unknown): Response => Response.json(body)
export const html = (body: string): Response =>
  new Response(body, { headers: { 'content-type': 'text/html' } })
