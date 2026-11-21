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
      '"||" after a draft, which the splitter does not follow',
      'node scripts/profile.ts draft p/x.yaml || echo b',
      [draft('p/x.yaml')],
    ],
    [
      'a ";" and an "echo ----" line inside a heredoc body',
      'node scripts/profile.ts draft p/x.yaml <<\'EOF\'\n{"a":";"}\necho ----; echo no\nEOF\necho done',
      [draft('p/x.yaml'), known('done')],
    ],
    ['a cat of a quoted heredoc', "cat <<'X'\none\ntwo; three\nX", [known('one', 'two; three')]],
    ['a draft piped on', 'node scripts/profile.ts draft p/x.yaml 2>&1 | head', [draft('p/x.yaml')]],
    ['a draft redirected', 'node scripts/profile.ts draft p/x.yaml > out.txt', [draft('p/x.yaml')]],
    [
      'an echo of a word the shell would expand',
      'echo "$x"; node scripts/profile.ts draft p/x.yaml',
      [draft('p/x.yaml')],
    ],
    [
      'an echo of a backtick word',
      'echo `date`; node scripts/profile.ts draft p/x.yaml',
      [draft('p/x.yaml')],
    ],
    ['an unquoted variable', 'echo $x', []],
    ['a cat of a word the shell would expand', 'cat "$f"', []],
    [
      'a "<<" in quotes before drafts',
      'echo "a << b"\nnode scripts/profile.ts draft p/a.yaml\necho ----\nnode scripts/profile.ts draft p/b.yaml',
      [draft('p/a.yaml'), draft('p/b.yaml')],
    ],
    [
      'a here-string',
      'node scripts/profile.ts draft p/a.yaml <<< word\necho ----\nnode scripts/profile.ts draft p/b.yaml',
      [draft('p/a.yaml'), draft('p/b.yaml')],
    ],
    [
      'a heredoc that never closes',
      'echo a\nnode scripts/profile.ts draft p/a.yaml <<EOF\n{}',
      [draft('p/a.yaml')],
    ],
    [
      'a quote that never closes',
      'echo "abc\nnode scripts/profile.ts draft p/a.yaml',
      [draft('p/a.yaml')],
    ],
    [
      'a backslash in double quotes',
      'echo "x\\ny"; node scripts/profile.ts draft p/a.yaml',
      [draft('p/a.yaml')],
    ],
    ['a printf', "printf 'a\\n'; node scripts/profile.ts draft p/a.yaml", [draft('p/a.yaml')]],
    [
      'a bash -lc',
      'bash -lc "echo a"; node scripts/profile.ts draft p/a.yaml',
      [draft('p/a.yaml')],
    ],
    [
      'an echo -e with a backslash',
      'echo -e "a\\nb"; node scripts/profile.ts draft p/a.yaml',
      [draft('p/a.yaml')],
    ],
    ['a heredoc after a quoted word', 'echo "x"; cat <<EOF\nb\nEOF', [known('x'), known('b')]],
    ['echo -n', 'echo -n a', [known('a')]],
    ['echo -n -e with no backslash', 'echo -n -e "a b"', [known('a b')]],
    ['an echo whose first word only looks like a flag', 'echo a -n', [known('a -n')]],
    ['a cat with a flag', 'cat -n f.md', [other]],
  ]
  for (const [name, command, parts] of cases)
    it('reads ' + name, () => {
      expect(partsOf(command, none)).toEqual(parts)
    })

  const files: Record<string, string> = { 'a.md': 'one\n', 'b.md': 'two\n' }
  const read = (p: string) => files[p]
  it('reads a cat of readable files as lines read from them', () => {
    expect(partsOf('cat a.md b.md', read)).toEqual([
      { kind: 'known', lines: ['one', 'two'], read: true },
    ])
  })
  it('does not know a cat when one of its files is unreadable', () => {
    expect(partsOf('cat a.md gone.md', read)).toEqual([other])
  })
  it('does not know a cat of a file the same command drafts, however it is written', () => {
    for (const path of ['a.md', './a.md', '/w/a.md', '"a.md"'])
      expect(partsOf('node scripts/profile.ts draft a.md\ncat ' + path, read)).toEqual([
        draft('a.md'),
        other,
      ])
  })
  it('knows a cat of a file the command does not draft', () => {
    expect(partsOf('node scripts/profile.ts draft b.md\ncat a.md', read)).toEqual([
      draft('b.md'),
      { kind: 'known', lines: ['one'], read: true },
    ])
  })
})
