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
