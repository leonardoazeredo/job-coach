import { describe, expect, it } from 'vitest'
import { cacheSummary, cacheTokens } from '../../examples/live-run/stream.ts'

const result = (usage: object) => JSON.stringify({ type: 'result', session_id: 'x', usage })
const assistant = JSON.stringify({ type: 'assistant', message: { content: [] } })

describe('the cache tokens of a turn', () => {
  it('are the read and written counts on the result line', () => {
    const stream = [
      assistant,
      result({ cache_read_input_tokens: 13023, cache_creation_input_tokens: 55329 }),
    ].join('\n')
    expect(cacheTokens(stream)).toEqual({ read: 13023, written: 55329 })
  })

  it('count as none when the result has no usage, no number or no line', () => {
    expect(cacheTokens(`${assistant}\n${result({})}`)).toEqual({ read: 0, written: 0 })
    expect(cacheTokens(result({ cache_read_input_tokens: 'many' }))).toEqual({
      read: 0,
      written: 0,
    })
    expect(cacheTokens(`not json\n${assistant}\n`)).toEqual({ read: 0, written: 0 })
  })

  it('are summed over the samples in the summary line', () => {
    const miss = result({ cache_read_input_tokens: 13023, cache_creation_input_tokens: 55329 })
    const hit = result({ cache_read_input_tokens: 68352, cache_creation_input_tokens: 173 })
    expect(cacheSummary([miss, hit, hit])).toBe('cache tokens read 149727, written 55675')
    expect(cacheSummary([])).toBe('cache tokens read 0, written 0')
  })
})
