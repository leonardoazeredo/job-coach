export interface Expectations {
  email: string | null
  keywords: string[]
  headings: string[]
  contact: string[]
  pairs: Array<[company: string, start: string]>
}

export interface EngineText {
  name: string
  text: string
  /** Producer-order extraction, which can lose the spaces between runs. */
  streamOrder: boolean
}

export interface CheckResult {
  failures: number
  lines: string[]
}

/** A link annotation: a /URI target, a jump with no action, a /URI action without a string target, or another action's type. */
export type LinkTarget =
  | { uri: string }
  | { jump: true }
  | { malformedUri: true }
  | { action: string }
