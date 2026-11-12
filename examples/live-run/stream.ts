// The session id in the result line of a raw claude stream. The line is found by its parsed
// `type`, as turn.sh does, because the claude command does not write `type` first.
export const resultSessionId = (stream: string): string | undefined => {
  for (const line of stream.split('\n')) {
    let event: { type?: unknown; session_id?: unknown }
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type === 'result' && typeof event.session_id === 'string' && event.session_id !== '')
      return event.session_id
  }
  return undefined
}

// The tokens a turn read from and wrote to the prompt cache, from the usage on the result line of
// its raw stream, which held the sum over the turn's model calls in the runs measured. A stream with no usable
// result line counts as none.
export const cacheTokens = (stream: string): { read: number; written: number } => {
  for (const line of stream.split('\n')) {
    let event: { type?: unknown; usage?: Record<string, unknown> }
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type !== 'result') continue
    const n = (k: string) => (typeof event.usage?.[k] === 'number' ? event.usage[k] : 0)
    return { read: n('cache_read_input_tokens'), written: n('cache_creation_input_tokens') }
  }
  return { read: 0, written: 0 }
}

// The replay's summary line says how much of the prompt cache the samples read and wrote, summed,
// so a miss shows without opening the raw streams.
export const cacheSummary = (streams: string[]): string => {
  const sum = streams.map(cacheTokens)
  const total = (k: 'read' | 'written') => sum.reduce((a, c) => a + c[k], 0)
  return `cache tokens read ${total('read')}, written ${total('written')}`
}
