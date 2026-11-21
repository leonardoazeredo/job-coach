import { describe, expect, it } from 'vitest'
import { partsOf } from '../../examples/live-run/command-parts.ts'

const draft = (file: string) => ({ kind: 'draft', file })
const known = (...lines: string[]) => ({ kind: 'known', lines })
const other = { kind: 'other' }
const none = () => undefined

describe('splitting a command into parts', () => {
  const cases: [string, string, unknown[]][] = [
    [
      '"&&" between parts',
      'echo a && node scripts/profile.ts draft p/x.yaml',
      [known('a'), draft('p/x.yaml')],
    ],
    [
      '"||" between parts',
      'node scripts/profile.ts draft p/x.yaml || echo b',
      [draft('p/x.yaml'), known('b')],
    ],
    [
      'a ";" and an "echo ----" line inside a heredoc body',
      'node scripts/profile.ts draft p/x.yaml <<\'EOF\'\n{"a":";"}\necho ----; echo no\nEOF\necho done',
      [draft('p/x.yaml'), known('done')],
    ],
    ['a cat of a quoted heredoc', "cat <<'X'\none\ntwo; three\nX", [known('one', 'two; three')]],
    ['a draft piped on', 'node scripts/profile.ts draft p/x.yaml 2>&1 | head', [draft('p/x.yaml')]],
    ['a draft redirected', 'node scripts/profile.ts draft p/x.yaml > out.txt', [draft('p/x.yaml')]],
    ['an echo of a word the shell would expand', 'echo "$x"', [other]],
    ['an echo of a backtick word', 'echo `date`', [other]],
    ['an unquoted variable', 'echo $x', [other]],
    ['a cat of a word the shell would expand', 'cat "$f"', [other]],
  ]
  for (const [name, command, parts] of cases)
    it('reads ' + name, () => {
      expect(partsOf(command, none)).toEqual(parts)
    })
})
