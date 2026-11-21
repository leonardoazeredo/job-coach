import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  costLine,
  draftsIn,
  readStream,
  readTranscript,
  recordTurn,
  runFolderCommand,
  runKind,
  runningTotal,
  totalAfter,
  transcriptBefore,
  transcriptBlock,
  turnCount,
  writeKind,
} from '../../examples/live-run/run-folder.ts'
import { EXIT } from '../lib/problem.ts'

const tmp = mkdtempSync(join(tmpdir(), 'run-folder-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
let count = 0
const newRun = () => {
  const run = join(tmp, `r${count++}`)
  mkdirSync(join(run, 'raw'), { recursive: true })
  return run
}

const result = (sid: string, cost?: number, usage?: object) =>
  JSON.stringify({
    duration_api_ms: 9,
    session_id: sid,
    total_cost_usd: cost,
    usage,
    type: 'result',
  })
const says = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

describe('reading a stream', () => {
  it('takes the session and the cost from the last result, wherever `type` sits in the line', () => {
    const s = readStream([result('S1', 0.1), says('hi'), result('S2', 0.3)].join('\n'))
    expect(s.sessionId).toBe('S2')
    expect(s.cost).toBe(0.3)
    expect(s.text).toEqual(['hi'])
  })

  it('skips a line that is not JSON and counts it', () => {
    const s = readStream(['not json', result('S1', 0.1), '', '[1]', '"x"'].join('\n'))
    expect(s.sessionId).toBe('S1')
    expect(s.skipped).toBe(3)
  })

  it('passes over a result with no session id and reads the one before it', () => {
    expect(readStream([result('S1', 0.1), result('', 0.2)].join('\n')).sessionId).toBe('S1')
    expect(readStream(result('', 0.2)).sessionId).toBeUndefined()
    expect(readStream('').sessionId).toBeUndefined()
  })

  it('has no cost when the result gives none, and counts cache tokens as 0 when absent', () => {
    const s = readStream(result('S1'))
    expect(s.cost).toBeUndefined()
    expect(s.cache).toEqual({ read: 0, written: 0 })
    const u = readStream(
      result('S1', 1, { cache_read_input_tokens: 5, cache_creation_input_tokens: 7 }),
    )
    expect(u.cache).toEqual({ read: 5, written: 7 })
  })
})

describe('the cost log', () => {
  const log = 'turn 1 0.5\nturn 2 0.75\nturn 2 0.9\n'

  it('has its last line as the running total, and 0 when there is none', () => {
    expect(runningTotal(log)).toBe(0.9)
    expect(runningTotal('')).toBe(0)
    expect(runningTotal('turn 1 undefined\n')).toBe(0)
  })

  it('answers the total after a turn from that turn’s last line', () => {
    expect(totalAfter(log, 2)).toBe(0.9)
    expect(totalAfter(log, 1)).toBe(0.5)
    expect(totalAfter(log, 3)).toBeUndefined()
    expect(totalAfter('turn 1 abc\n', 1)).toBeUndefined()
  })

  it('writes a line the readers read', () => {
    expect(totalAfter(costLine(4, 1.25), 4)).toBe(1.25)
    expect(costLine(4, 1.25)).toBe('turn 4 1.25\n')
  })
})

describe('the transcript', () => {
  it('quotes each line of both sides, and reads the coach’s reply back without the quotes', () => {
    const block = transcriptBlock(2, 'ask\nmore\n', 'one\n\ntwo')
    expect(block).toBe(
      '## Turn 2\n\n**Persona:**\n\n> ask\n> more\n\n**Coach:**\n\n> one\n> \n> two\n',
    )
    const run = newRun()
    writeFileSync(join(run, 'transcript.md'), block + transcriptBlock(3, 'q', 'a'))
    expect(readTranscript(run)).toEqual([
      { n: 2, reply: 'one\n\ntwo' },
      { n: 3, reply: 'a' },
    ])
    expect(turnCount(run)).toBe(2)
  })

  it('matches byte for byte what the old sed and printf block wrote, with and without a trailing newline', () => {
    // Taken from running that block with /usr/bin/sed on each pair of files.
    const cases: [string, string, string][] = [
      [
        'ask\n',
        'one\n\ntwo',
        '## Turn 2\n\n**Persona:**\n\n> ask\n\n**Coach:**\n\n> one\n> \n> two\n',
      ],
      ['ask', 'one\n', '## Turn 2\n\n**Persona:**\n\n> ask\n**Coach:**\n\n> one\n\n'],
      ['ask\nmore\n', 'one', '## Turn 2\n\n**Persona:**\n\n> ask\n> more\n\n**Coach:**\n\n> one\n'],
      ['', '', '## Turn 2\n\n**Persona:**\n\n\n**Coach:**\n\n\n'],
    ]
    for (const [persona, coach, expected] of cases)
      expect(transcriptBlock(2, persona, coach), JSON.stringify([persona, coach])).toBe(expected)
  })

  it('gives the blocks before a turn as written, whatever follows the heading', () => {
    const run = newRun()
    const one = transcriptBlock(1, 'a', 'b')
    writeFileSync(
      join(run, 'transcript.md'),
      `${one}${transcriptBlock(2, 'c', 'd')}`.replace('## Turn 2', '## Turn 2  '),
    )
    expect(transcriptBefore(run, 2)).toBe(one)
    expect(transcriptBefore(run, 1)).toBe('')
    expect(turnCount(run)).toBe(2)
  })
})

describe('the kind of run', () => {
  it('is what the run says it is', () => {
    const run = newRun()
    writeKind(run, 'update')
    expect(runKind(run)).toBe('update')
    writeKind(run, 'onboarding')
    expect(runKind(run)).toBe('onboarding')
  })

  it('is told from what an old run holds when it has no kind file', () => {
    const bare = newRun()
    expect(runKind(bare)).toBe('onboarding')
    const engine = newRun()
    mkdirSync(join(engine, 'engine'))
    expect(runKind(engine)).toBe('update')
    const finished = newRun()
    mkdirSync(join(finished, 'written'))
    writeFileSync(join(finished, 'written', 'log.txt'), '')
    expect(runKind(finished)).toBe('update')
    const rules = newRun()
    mkdirSync(join(rules, 'written'))
    writeFileSync(join(rules, 'written', 'rules.yaml'), '')
    expect(runKind(rules)).toBe('update')
  })

  it('lets a kind file override what the folder holds, and ignores a kind it does not know', () => {
    const run = newRun()
    mkdirSync(join(run, 'engine'))
    writeKind(run, 'onboarding')
    expect(runKind(run)).toBe('onboarding')
    writeFileSync(join(run, 'kind'), 'other\n')
    expect(runKind(run)).toBe('update')
  })
})

describe('recording a turn', () => {
  const setup = (stream: string, costlog = 'turn 1 0.5\n') => {
    const run = newRun()
    writeFileSync(join(run, 'raw', 'turn2.jsonl'), stream)
    writeFileSync(join(run, 'costlog.txt'), costlog)
    const reply = join(tmp, `reply${count}.txt`)
    writeFileSync(reply, 'message 2\n')
    return { run, reply }
  }

  it('keeps the session, the cost line, the text, the message and the transcript block', () => {
    const { run, reply } = setup([says('first'), says('second'), result('S2', 0.75)].join('\n'))
    expect(recordTurn(run, 2, reply)).toEqual({})
    const read = (f: string) => readFileSync(join(run, f), 'utf8')
    expect(read('session.id')).toBe('S2')
    expect(read('costlog.txt')).toBe('turn 1 0.5\nturn 2 0.75\n')
    expect(read('last.txt')).toBe('first\n\nsecond')
    expect(read('raw/reply2.txt')).toBe('message 2\n')
    expect(read('transcript.md')).toBe(transcriptBlock(2, 'message 2\n', 'first\n\nsecond'))
  })

  it('records nothing for a turn with no result, and names both files that hold why', () => {
    const { run, reply } = setup('not json\n')
    const r = recordTurn(run, 2, reply)
    expect(r).toEqual({
      failure: `turn 2 left no result; ${run}/raw/turn2.err and ${run}/raw/turn2.jsonl hold why`,
    })
    expect(readFileSync(join(run, 'costlog.txt'), 'utf8')).toBe('turn 1 0.5\n')
    expect(existsSync(join(run, 'transcript.md'))).toBe(false)
    expect(existsSync(join(run, 'session.id'))).toBe(false)
  })

  it('notes a skipped line and still records the turn', () => {
    const { run, reply } = setup(['oops', 'oops', result('S2', 0.75)].join('\n'))
    expect(recordTurn(run, 2, reply)).toEqual({
      note: 'raw/turn2.jsonl: skipped 2 lines that are not JSON',
    })
    expect(readFileSync(join(run, 'session.id'), 'utf8')).toBe('S2')
    const one = setup(['oops', result('S2', 0.75)].join('\n'))
    expect(recordTurn(one.run, 2, one.reply)).toEqual({
      note: 'raw/turn2.jsonl: skipped 1 line that is not JSON',
    })
  })

  it('keeps the previous total when the result has no cost, and says so', () => {
    const { run, reply } = setup(result('S2'), 'turn 1 0.5\n')
    expect(recordTurn(run, 2, reply)).toEqual({
      note: 'raw/turn2.jsonl: the result has no total_cost_usd; the cost log keeps 0.5',
    })
    expect(readFileSync(join(run, 'costlog.txt'), 'utf8')).toBe('turn 1 0.5\nturn 2 0.5\n')
  })
})

describe('the command line', () => {
  const capture = (args: string[]) => {
    const out: string[] = []
    const log = console.log
    console.log = (m: unknown) => void out.push(String(m))
    try {
      return { code: runFolderCommand(args), out }
    } finally {
      console.log = log
    }
  }

  it('prints the total, the session and the turn count', () => {
    const run = newRun()
    writeFileSync(join(run, 'costlog.txt'), 'turn 1 0.5\nturn 2 0.75\n')
    writeFileSync(join(run, 'session.id'), 'S2')
    writeFileSync(join(run, 'transcript.md'), transcriptBlock(1, 'a', 'b'))
    expect(capture(['total', run])).toEqual({ code: 0, out: ['0.75'] })
    expect(capture(['session', run])).toEqual({ code: 0, out: ['S2'] })
    expect(capture(['turns', run])).toEqual({ code: 0, out: ['1'] })
  })

  it('records a turn and prints its note, or fails with exit 2 and the message', () => {
    const run = newRun()
    writeFileSync(join(run, 'raw', 'turn2.jsonl'), `oops\n${result('S2', 0.75)}\n`)
    const reply = join(run, 'r.txt')
    writeFileSync(reply, 'hi')
    expect(capture(['record', run, '2', reply])).toEqual({
      code: 0,
      out: ['raw/turn2.jsonl: skipped 1 line that is not JSON'],
    })
    expect(capture(['record', run, '3', reply])).toEqual({
      code: EXIT.data,
      out: [`turn 3 left no result; ${run}/raw/turn3.err and ${run}/raw/turn3.jsonl hold why`],
    })
  })

  it('refuses a call it does not understand with the usage code', () => {
    const run = newRun()
    expect(runFolderCommand(['record', run])).toBe(EXIT.usage)
    expect(runFolderCommand(['nope', run])).toBe(EXIT.usage)
    expect(runFolderCommand([])).toBe(EXIT.usage)
  })
})

describe('the drafts in a stream', () => {
  const use = (id: string, file: string) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id, input: { command: `node scripts/profile.ts draft ${file}` } },
        ],
      },
    })
  const out = (id: string, text: string, isError = false) =>
    JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
      },
    })

  it('pairs a call with its result, keeps both summaries of a file drafted twice and flags the wins file', () => {
    const d = draftsIn(
      [
        use('a', 'profile/wins.yaml'),
        out('a', 'old\nline'),
        use('b', 'profile/wins.yaml'),
        out('b', 'new one\n\nnew two'),
        'junk',
      ].join('\n'),
    )
    // The false finding on the first summary is accepted, see the comment in draftsIn.
    expect(d).toEqual({ summaries: ['old', 'line', 'new one', 'new two'], winsDrafted: true })
  })

  describe('a command that drafts and echoes', () => {
    const call = (command: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'c', input: { command } }] },
      })
    const draft = (f: string) => 'node scripts/profile.ts draft ' + f
    const both = (sep: string) =>
      draft('profile/identity.yaml') + '\n' + sep + '\n' + draft('profile/search.yaml')
    const summaries = (command: string, result: string) =>
      draftsIn(call(command) + '\n' + out('c', result)).summaries
    const callAs = (id: string, command: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id, input: { command } }] },
      })

    it('leaves out a separator the command echoed between two drafts', () => {
      expect(summaries(both('echo ----'), 'Name: A\n----\nCity: B')).toEqual(['Name: A', 'City: B'])
    })

    it('still counts a summary line that is dropped from the result of such a command', () => {
      const lines = summaries(both('echo ----'), 'Name: A\n----\nCity: B\nCountry: C')
      expect(lines).toContain('Country: C')
    })

    it('never leaves out an echoed text that holds a letter or a digit', () => {
      expect(summaries(both('echo Done'), 'Name: A\nDone\nCity: B')).toContain('Done')
      expect(summaries(both("echo 'Name: X'"), 'Name: X\nCity: B')).toContain('Name: X')
      expect(summaries(both('echo 2024'), 'Name: A\n2024\nCity: B')).toContain('2024')
    })

    it('leaves out a separator only when the command echoed that very text', () => {
      expect(summaries(both('echo ===='), 'Name: A\n----\nCity: B')).toContain('----')
    })

    it('leaves out a separator a summary also holds, and still counts the real lines', () => {
      const result = 'Name: A\n----\nCity: B\n----\nCountry: C'
      const shown = summaries(both('echo ----'), result)
      expect(shown).toEqual(['Name: A', 'City: B', 'Country: C'])
      expect(shown).not.toContain('----')
    })

    it('counts a line of only non-Latin letters that the command echoed exactly', () => {
      expect(summaries(both('echo こんにちは'), 'Name: A\nこんにちは\nCity: B')).toContain(
        'こんにちは',
      )
    })

    it('keeps the flag for the achievements file when another draft follows in the turn', () => {
      const d = draftsIn(
        [
          call(draft('profile/wins.yaml')),
          out('c', 'Win: A'),
          use('d', 'profile/identity.yaml'),
          out('d', 'Name: A'),
        ].join('\n'),
      )
      expect(d.winsDrafted).toBe(true)
    })

    it('flags the achievements file when it is the first of two drafts in one command', () => {
      const command = both('echo ----').replace('identity.yaml', 'wins.yaml')
      expect(draftsIn(call(command) + '\n' + out('c', 'Win: A\n----\nCity: B')).winsDrafted).toBe(
        true,
      )
    })

    it.each([
      ['a command after it', 'node scripts/profile.ts draft profile/wins.yaml; echo x'],
      ['quotes', 'node scripts/profile.ts draft "profile/wins.yaml"'],
      ['a redirect', 'node scripts/profile.ts draft profile/wins.yaml>/dev/null'],
      ['a pipe', 'node scripts/profile.ts draft profile/wins.yaml|cat'],
      ['a subshell', '(node scripts/profile.ts draft profile/wins.yaml)'],
      ['&&', 'node scripts/profile.ts draft profile/wins.yaml && echo x'],
      [
        'a heredoc with a space',
        "node scripts/profile.ts draft profile/wins.yaml <<'EOF'\n{}\nEOF",
      ],
      [
        'a heredoc without a space',
        "node scripts/profile.ts draft profile/wins.yaml<<'EOF'\n{}\nEOF",
      ],
    ])('flags the achievements file named with %s', (_name, command) => {
      expect(draftsIn(call(command) + '\n' + out('c', 'Name: A')).winsDrafted).toBe(true)
    })

    it('flags an unknown call whose command holds the achievements file (a false check, accepted)', () => {
      const command = 'node scripts/profile.ts draft profile/identity.yaml; echo wins.yaml'
      expect(draftsIn(call(command) + '\n' + out('c', 'Name: A')).winsDrafted).toBe(true)
    })

    it('does not flag the achievements file when a call with a plain name only has an echo naming it', () => {
      const command = 'node scripts/profile.ts draft profile/identity.yaml\necho wins.yaml'
      expect(draftsIn(call(command) + '\n' + out('c', 'Name: A')).winsDrafted).toBe(false)
    })

    it('counts the lines of an error result when the command holds several drafts', () => {
      const result = 'Name: A\nboom: search.yaml failed'
      const d = draftsIn(call(both('echo ----')) + '\n' + out('c', result, true))
      expect(d.summaries).toEqual(['Name: A', 'boom: search.yaml failed'])
    })

    it('counts the lines of an error result when the command holds one draft', () => {
      const command = draft('profile/identity.yaml') + '; cat missing-file'
      const d = draftsIn(
        call(command) + '\n' + out('c', 'Name: A\ncat: missing-file: No such file', true),
      )
      expect(d.summaries).toEqual(['Name: A', 'cat: missing-file: No such file'])
    })

    it('adds an error result of a redraft to the earlier summary of the same file', () => {
      const d = draftsIn(
        [
          use('a', 'profile/search.yaml'),
          out('a', 'Search city: Leeds'),
          use('b', 'profile/search.yaml'),
          out('b', 'boom: search.yaml failed', true),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'boom: search.yaml failed'])
    })

    it('drops an earlier error result of a file when a good redraft follows, and keeps the good summary', () => {
      const d = draftsIn(
        [
          use('a', 'profile/search.yaml'),
          out('a', 'Search city: Leeds'),
          use('b', 'profile/search.yaml'),
          out('b', 'boom: search.yaml failed', true),
          use('c', 'profile/search.yaml'),
          out('c', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'Search city: York'])
    })

    it('drops an error result when a good call drafts every file its command named', () => {
      const d = draftsIn(
        [
          call(both('echo ----')),
          out('c', 'Name: A\nboom: search.yaml failed', true),
          callAs('d', both('echo ----')),
          out('d', 'Name: B\n----\nCity: B2'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Name: B', 'City: B2'])
    })

    it('keeps an error result when the good redraft covers only some of its files', () => {
      const d = draftsIn(
        [
          call(both('echo ----')),
          out('c', 'Name: A\nboom: search.yaml failed', true),
          use('d', 'profile/search.yaml'),
          out('d', 'City: B2'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Name: A', 'boom: search.yaml failed', 'City: B2'])
    })

    it('keeps an error result when a later error result drafts all of its files', () => {
      const d = draftsIn(
        [
          use('a', 'profile/search.yaml'),
          out('a', 'boom: one', true),
          use('b', 'profile/search.yaml'),
          out('b', 'boom: two', true),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['boom: one', 'boom: two'])
    })

    // Limit: a refusal whose command exits 0 is not an error result, so it is never dropped.
    it('keeps the lines of a refusal that exited 0 next to a good redraft of the same file', () => {
      const d = draftsIn(
        [
          use('a', 'profile/search.yaml'),
          out('a', 'refused: search.yaml has no city'),
          use('b', 'profile/search.yaml'),
          out('b', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['refused: search.yaml has no city', 'Search city: York'])
    })

    it('flags the achievements file when the command failed after its draft', () => {
      const command = draft('profile/wins.yaml') + '; grep x file'
      expect(draftsIn(call(command) + '\n' + out('c', 'Name: A', true)).winsDrafted).toBe(true)
    })

    it('lets an echo text inside a heredoc body excuse a separator line, which carries nothing', () => {
      const command =
        draft('profile/identity.yaml') +
        "\ncat > notes.txt <<'EOF'\necho ----\nEOF\n" +
        draft('profile/search.yaml')
      expect(summaries(command, 'Name: A\n----\nCity: B')).toEqual(['Name: A', 'City: B'])
    })

    it('flags the achievements file for a second draft and for a heredoc written without a space', () => {
      const wins = (command: string) =>
        draftsIn(call(command) + '\n' + out('c', 'Name: A')).winsDrafted
      expect(wins(both('echo ----').replace('search.yaml', 'wins.yaml'))).toBe(true)
      expect(wins("node scripts/profile.ts draft profile/wins.yaml<<'EOF'\n{}\nEOF")).toBe(true)
      expect(wins(both('echo ----'))).toBe(false)
    })
  })

  describe('two calls in one turn', () => {
    const callAs = (id: string, command: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id, input: { command } }] },
      })
    const draft = (f: string) => `node scripts/profile.ts draft ${f}`
    const identity = 'profile/identity.yaml'
    const search = 'profile/search.yaml'
    const twoFiles = `${draft(identity)}\necho ----\n${draft(search)}`
    const shown = (...parts: string[]) => draftsIn(parts.join('\n')).summaries

    it('keeps the summaries of two different files drafted in separate calls', () => {
      expect(
        shown(use('a', identity), out('a', 'Name: A'), use('b', search), out('b', 'City: B')),
      ).toEqual(['Name: A', 'City: B'])
    })

    it('keeps the earlier lines of a file the later call did not draft', () => {
      expect(
        shown(
          callAs('a', twoFiles),
          out('a', 'Name: A\n----\nCity: B'),
          use('b', search),
          out('b', 'City: B2'),
        ),
      ).toEqual(['Name: A', 'City: B', 'City: B2'])
    })

    it('never replaces a good result, even when the later call drafts every file it did', () => {
      expect(
        shown(
          use('a', search),
          out('a', 'City: B'),
          callAs('b', twoFiles),
          out('b', 'Name: B\n----\nCity: B2'),
        ),
      ).toEqual(['City: B', 'Name: B', 'City: B2'])
    })

    it('keeps the summary of a two-draft result where one draft printed "No change."', () => {
      // The "No change." line stays with the summary: only a result that is that alone is skipped.
      expect(shown(callAs('a', twoFiles), out('a', 'Name: A\n----\nNo change.'))).toEqual([
        'Name: A',
        'No change.',
      ])
      expect(shown(callAs('a', twoFiles), out('a', 'No change.\n----\nCity: B'))).toEqual([
        'No change.',
        'City: B',
      ])
    })

    it('leaves out a result that is "No change." alone, however it is padded', () => {
      expect(shown(use('a', search), out('a', '\n No change. \n'))).toEqual([])
    })
  })

  describe('a draft call whose file name follows a redirect', () => {
    const callAs = (id: string, command: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id, input: { command } }] },
      })
    const heredoc = "node scripts/profile.ts draft <<'EOF' profile/wins.yaml\n{}\nEOF"
    const fromFile = 'node scripts/profile.ts draft < a.json profile/search.yaml'

    it.each([
      ['a heredoc opener before the name', heredoc, true],
      ['an input file before the name', fromFile, false],
    ])('counts the summary lines with %s', (_name, command, wins) => {
      const d = draftsIn(callAs('a', command) + '\n' + out('a', 'Name: A\nCity: B'))
      expect(d).toEqual({ summaries: ['Name: A', 'City: B'], winsDrafted: wins })
    })

    it('keeps an error entry whose files are unknown after a later good call', () => {
      const d = draftsIn(
        [
          callAs('a', fromFile.replace(' profile/search.yaml', ' && cat nope')),
          out('a', 'Search city: Leeds\ncat: nope', true),
          use('b', 'profile/search.yaml'),
          out('b', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'cat: nope', 'Search city: York'])
    })

    it('lets a later call with unknown files drop nothing', () => {
      const d = draftsIn(
        [
          callAs('a', 'node scripts/profile.ts draft profile/search.yaml && cat nope'),
          out('a', 'Search city: Leeds\ncat: nope', true),
          callAs(
            'b',
            'node scripts/profile.ts draft profile/search.yaml && node scripts/profile.ts draft < b.json',
          ),
          out('b', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'cat: nope', 'Search city: York'])
    })

    it.each([
      ['"No change."', 'No change.'],
      ['an empty result', ''],
      ['only a write line', 'written: profile/search.yaml'],
    ])('keeps an error entry when the later call that drafts its file printed %s', (_n, later) => {
      const d = draftsIn(
        [
          callAs('a', 'node scripts/profile.ts draft profile/search.yaml && cat nope'),
          out('a', 'Search city: Leeds\ncat: nope', true),
          use('b', 'profile/search.yaml'),
          out('b', later),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'cat: nope'])
    })

    const wins = (command: string) =>
      draftsIn(callAs('a', command) + '\n' + out('a', 'Name: A')).winsDrafted
    const draft = (f: string) => `node scripts/profile.ts draft ${f}`

    it('keeps a line of an error entry whose draft is followed by a semicolon, after a later good call', () => {
      const d = draftsIn(
        [
          callAs(
            'a',
            `${draft('profile/search.yaml')} < a.json; ${draft('profile/identity.yaml')} < b.json; cat nope`,
          ),
          out('a', 'Search city: Leeds\nName: Hannah\ncat: nope', true),
          callAs('b', `${draft('profile/search.yaml')} < c.json`),
          out('b', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual([
        'Search city: Leeds',
        'Name: Hannah',
        'cat: nope',
        'Search city: York',
      ])
    })

    it('pins a name with a trailing semicolon as unknown, so the error entry stays', () => {
      const d = draftsIn(
        [
          callAs('a', `${draft('profile/search.yaml')}; cat nope`),
          out('a', 'Search city: Leeds\ncat: nope', true),
          use('b', 'profile/search.yaml'),
          out('b', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'cat: nope', 'Search city: York'])
    })

    it('drops an error entry for a plain redraft of the same file', () => {
      const d = draftsIn(
        [
          callAs('a', `${draft('profile/search.yaml')} && cat nope`),
          out('a', 'Search city: Leeds\ncat: nope', true),
          use('b', 'profile/search.yaml'),
          out('b', 'Search city: York'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: York'])
    })

    it('keeps the lines of an error entry when the call has a line continuation after draft', () => {
      const d = draftsIn(
        [
          callAs('a', 'node scripts/profile.ts draft \\\nprofile/search.yaml && cat nope'),
          out('a', 'Search city: Leeds\ncat: nope', true),
          callAs('b', 'node scripts/profile.ts draft \\\nprofile/identity.yaml'),
          out('b', 'Name: B'),
        ].join('\n'),
      )
      expect(d.summaries).toEqual(['Search city: Leeds', 'cat: nope', 'Name: B'])
    })

    it('counts and flags a call whose continuation sits between profile.ts and draft', () => {
      const command = 'node scripts/profile.ts \\\ndraft profile/wins.yaml'
      expect(draftsIn(callAs('a', command) + '\n' + out('a', 'Win: A'))).toEqual({
        summaries: ['Win: A'],
        winsDrafted: true,
      })
    })

    it.each([
      ['after a semicolon', `${draft('profile/identity.yaml')}; ${draft('profile/wins.yaml')}`],
      [
        'after && with no spaces',
        `${draft('profile/identity.yaml')}&&${draft('profile/wins.yaml')}`,
      ],
      ['after a subshell', `(${draft('profile/identity.yaml')}); ${draft('profile/wins.yaml')}`],
    ])('flags the achievements file as a second draft %s', (_n, command) => {
      expect(wins(command)).toBe(true)
    })
  })

  describe('a draft call whose file name is not a plain path with an extension', () => {
    const callAs = (id: string, command: string) =>
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id, input: { command } }] },
      })
    const draft = (f: string) => 'node scripts/profile.ts draft ' + f
    const shown = (...parts: string[]) => draftsIn(parts.join('\n')).summaries
    const wins = (command: string) =>
      draftsIn(callAs('a', command) + '\n' + out('a', 'Name: A')).winsDrafted

    it.each([
      ['a descriptor number before an input file', draft('0<a.json profile/search.yaml')],
      ['a descriptor number before a heredoc', draft("0<<'EOF' profile/search.yaml\n{}\nEOF")],
    ])(
      'keeps the lines of an error entry when the next call has %s only in the first',
      (_n, first) => {
        expect(
          shown(
            callAs('a', first + '; cat nope'),
            out('a', 'Search city: Leeds\ncat: nope', true),
            callAs('b', draft('0<b.json profile/identity.yaml')),
            out('b', 'Name: B'),
          ),
        ).toEqual(['Search city: Leeds', 'cat: nope', 'Name: B'])
      },
    )

    it('flags the achievements file named after a descriptor number', () => {
      expect(wins(draft('0<a.json profile/wins.yaml'))).toBe(true)
    })

    it('treats a bare draft at a line end followed by another word as unknown', () => {
      expect(
        shown(
          callAs('a', draft('profile/search.yaml') + '\n' + draft('\necho x') + '; false'),
          out('a', 'Search city: Leeds', true),
          callAs('b', draft('profile/search.yaml')),
          out('b', 'Search city: York'),
        ),
      ).toEqual(['Search city: Leeds', 'Search city: York'])
    })

    it.each([
      ['a relative path with ./', './profile/wins.yaml'],
      ['an absolute path', '/Users/x/job/profile/wins.yaml'],
    ])('flags the achievements file given as %s', (_n, file) => {
      expect(wins(draft(file))).toBe(true)
    })

    it('makes a call with a variable name unknown, so it never covers an error entry', () => {
      expect(
        shown(
          callAs('a', 'F=profile/wins.yaml; ' + draft('$F') + ' ; false'),
          out('a', 'Achievement: KEEP', true),
          callAs('b', 'F=profile/stack.yaml; ' + draft('$F')),
          out('b', 'Stack: S'),
        ),
      ).toEqual(['Achievement: KEEP', 'Stack: S'])
    })

    it('flags the achievements file drafted through a variable', () => {
      expect(wins('W=profile/wins.yaml; ' + draft('$W'))).toBe(true)
    })

    it('makes the whole call unknown when one of several names is not plain', () => {
      const two = (f: string) => 'D=profile; ' + draft('profile/stack.yaml') + ' ; ' + draft(f)
      expect(
        shown(
          callAs('a', two('$F') + ' ; false'),
          out('a', 'Stack: KEEP', true),
          callAs('b', two('$F')),
          out('b', 'Stack: S'),
        ),
      ).toEqual(['Stack: KEEP', 'Stack: S'])
    })

    it('does not read a name that holds a variable as plain even when it ends in an extension', () => {
      expect(
        shown(
          callAs('a', 'D=profile; ' + draft('$D/wins.yaml') + ' ; false'),
          out('a', 'Achievement: KEEP', true),
          callAs('b', 'D=profile; ' + draft('$D/wins.yaml')),
          out('b', 'Achievement: NEW'),
        ),
      ).toEqual(['Achievement: KEEP', 'Achievement: NEW'])
    })
  })

  it.each([
    ['"No change."', 'No change.'],
    ['only write lines', 'written: profile/wins.yaml\ndropped: profile/voice.md'],
    ['an empty result', ''],
  ])('flags the achievements file when its result is %s', (_name, result) => {
    const d = draftsIn([use('a', 'profile/wins.yaml'), out('a', result)].join('\n'))
    expect(d).toEqual({ summaries: [], winsDrafted: true })
  })

  it('leaves out an empty result and "No change."', () => {
    const d = draftsIn(
      [
        use('a', 'profile/voice.md'),
        out('a', 'No change.'),
        use('c', 'profile/coach.md'),
        out('c', '  '),
      ].join('\n'),
    )
    expect(d).toEqual({ summaries: [], winsDrafted: false })
  })
})
