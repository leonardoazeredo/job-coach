# Live onboarding run

The proof that a change to the coach's conversation works: a fictional person is played through a whole onboarding against a copy of the engine, then a separate reader judges it. All of it uses fictional data; never point it at a real user's copy.

A run takes about an hour if nothing stops to ask for permission, and costs about $1 to $2 on `claude-sonnet-5-5`. It stops itself at $5 (`LIVE_RUN_BUDGET_USD`).

It needs Docker and a Claude Code token in `CLAUDE_CODE_OAUTH_TOKEN`. Give the token to `examples/live-run/start.sh` once. `examples/live-run/up.sh` puts it in the run's container, where it stays until `finish.sh` removes the container, so no turn needs it and no script prints it.

## Steps

1. Commit the change. Run `examples/live-run/start.sh <run-dir>` with the token in its environment, with a new folder outside this checkout as `<run-dir>`. It copies this checkout's HEAD.
2. Start one agent with the player's brief below. It plays until the coach finishes, then runs `examples/live-run/finish.sh <run-dir>`.
3. Run `node examples/live-run/score.ts <run-dir>` and save its output to `<run-dir>/score.txt`. It marks the lines of the checklist a script can mark (summary relayed whole, extra framing sentences, working words, ordinals, pronouns in written files, the turn count), one finding per line, and writes nothing into the run folder. A finding is a report: the exit code says only whether the folder could be scored.
4. Start a different agent with the judge's brief below.
5. Read the report and spot-check its quotes. A line that fails is either fixed in the skill or filed as an issue.
6. Build the comment with `node examples/live-run/comment.ts <run-dir> [<previous-comment-or-report>]` and read it. It writes `<run-dir>/comment.md` and posts nothing. Post it as one comment on the issue the run tests, or on the PR when there is no issue: `gh issue comment <n> --repo <owner/repo> --body-file <run-dir>/comment.md`. The run folder does not outlast the run, so this comment is the record. It holds the verdict lines verbatim; keep its text (copy `comment.md` to a file outside the run folder, or fetch just the latest run's comment later with `gh issue view <n> --repo <owner/repo> --json comments --jq '.comments[-1].body' > <file>`, after checking that the last comment on the issue is that run's verdict) and pass that file as the second argument of the next run's build, which then names the lines fixed since. A judge report works as that argument too.

## The player's brief

> You play a fictional job seeker in a live test of a job-search coach. You talk to the real coach through a script. Your only job is to play the person faithfully and drive the conversation to its end. You do not judge the coach.
>
> Read only this brief, in full, and stay in character: `examples/personas/leeds-transport-planner.md`. Read nothing else: not the coach's skills, not `<run-dir>/copy` or `<run-dir>/raw`, not GitHub issues, not any earlier run. What you know of the coach is what the script prints.
>
> Each turn, write your message and nothing else to `<run-dir>/r.txt` as its own step, then run `examples/live-run/turn.sh <run-dir> <n> <run-dir>/r.txt` as one command with full paths and no variable, chaining or redirect, with `n` starting at 1 and a timeout of ten minutes. It prints the coach's reply and the cost so far.
>
> Answer what is asked, the way the brief says this person would. Volunteer nothing else: if the coach never asks for something, the person never mentions it. Never coach the coach, mention the test, or use technical words this person would not use. If asked something the brief does not cover, say you are not sure or would rather not say, and invent no fact or figure.
>
> Once only: the first time the coach offers to leave the optional sections for later, or says setup is done with sections left over, send exactly "I've got time now. Can we do the rest, the achievements first?" and note the turn. After that, accept what is offered.
>
> Stop when the coach says setup is finished and nothing is left, when the script prints `STOP` (do not get round it), or when a turn fails twice in a row. Then run `examples/live-run/finish.sh <run-dir>`. Hand back the turns played, the nudge's turn, the total cost, why you stopped and any fault in running the script. Do not evaluate the coach.

## The judge's brief

> You judge a finished live test of a job-search coach. You took no part in it. All the content is fictional. Be exact and sceptical, and quote the transcript. Do not soften a failure or invent one.
>
> Read `examples/live-run/checklist.md` and report on every line. A script has already marked some lines: its output is in `<run-dir>/score.txt`. Take each finding as a lead to check against the transcript, quote it only if it holds, and spend your reading on the lines the script cannot mark (the others, and which extra framing sentences are notes the skill asks for). Your evidence is the persona's brief (`examples/personas/leeds-transport-planner.md`), `<run-dir>/transcript.md`, `<run-dir>/written/` and, for tool calls, `<run-dir>/raw/turn<n>.jsonl` (large: use grep or targeted reads). You may read the engine's rule text and templates to understand a line, but judge what the coach did, not what its files say. T<n> means the persona's n-th message and the coach reply that follows it. Read no earlier run, and not the player's reasoning.
>
> Every quote must be exact, because it will be spot-checked. Write the full report to `<run-dir>/judge-report.txt`, with a verdict line per checklist line at the top, written `line 26 FAIL T15, T16` (`PASS`, `FAIL`, `BORDERLINE` or `SKIPPED`, then the turns or the file and line), followed by the quotes, one per line, written `line 26 T15 "exact quote"`. Send back the path and those verdict lines.

## Replaying one turn

A wording change aimed at one turn of a saved run (an opening that narrates its steps, a summary that is not relayed whole) is cheaper to test by replaying that turn than by running everything again. The first sample writes the saved conversation to the prompt cache and the others read it, so the first reply costs more the longer the conversation is (about $0.15 at turn 25, about $0.25 at turn 62) and a later reply, if the cache is still warm, costs under a cent at turn 25 and about four cents at turn 62. The summary line says how many cache tokens the samples read and wrote.

`node examples/live-run/replay.ts <run-dir> <turn> [n]` with the token in its environment (`n` is 5 by default). Each of the `n` samples starts from the run's state before that turn, with this checkout's `CLAUDE.md` and skills put in (the skills the coach had loaded are swapped in its saved session too), sends the persona's original message for that turn and is marked by the scorer. It prints the fail rate per scored line, then each reply with its findings. The samples are independent and live in a new folder under the system's temporary folder, which is printed; the run folder is only read. The stop (`LIVE_RUN_BUDGET_USD`, 5 if unset, a number above 0) is the budget for the replay: it applies to the sum of what the samples spend, not counting what the run spent before that turn, and is checked between samples only: one sample may spend up to the whole `LIVE_RUN_BUDGET_USD`, so a replay can end up to one budget over. Every sample is handed the same budget, made only from the run's total before the turn and `LIVE_RUN_BUDGET_USD`, because the claude command writes it into the last message of the turn, where the cache mark sits: a different budget would make a sample miss the cache another one wrote. So replays of one turn share the cache only when run with the same `LIVE_RUN_BUDGET_USD` and within the cache's lifetime (one hour after its last use). A sample that fails ends the replay, and the samples already done are still marked and printed.

A replay needs a run that `turn.sh` kept snapshots for (`<run-dir>/snap`), so a run made before that has to be run again once.

Replay when the change touches the wording of one turn: what the coach says given what it was asked and what it already knows. Run in full when the change alters the order of questions or of files, or anything a later turn depends on, because a replay starts from the run as it was and never plays the turns after.

Two limits. A replay puts this checkout's text of each skill the coach had loaded into the sample's copy of the saved session (it prints which skills it swapped, and stops with one line naming a skill whose old text it cannot find), so a change to a step the coach acts on at the replayed turn shows in the replies. A change to a standing rule may not: the turns before the replayed one were answered under the old wording, and a replay does not redo them, so a rate that does not move for such a rule is not proof the wording failed and is settled by a full run. `CLAUDE.md` is read afresh and always applies. And a sample's reply is one draw: read a rate over five as a direction, and raise `n` before trusting a small difference.

## An update run

The same kind of proof for `update-coach` in a folder that keeps history. The fictional Dana Okafor (`examples/austin-backend`) has a copy made from this checkout's HEAD with one setting of her own, and updates to a local engine one version ahead that changed the same setting. It takes a few turns and costs well under $1.

1. Commit the change. Run `examples/live-run/start-update.sh <run-dir>` with the token in its environment, with a new folder outside this checkout as `<run-dir>`. It builds the copy and the engine, starts the container and installs the coach's packages.
2. Start one agent with the player's brief above, with `examples/personas/austin-update.md` as the brief to read and no nudge: drop the "Once only" paragraph. When it stops, it runs `examples/live-run/finish-update.sh <run-dir>` in place of `finish.sh`.
3. Run the scorer as above; for an update run it marks only the narrated steps and notes to itself in the line on the words she reads. A `line 13 PASS` leaves the judge to read that line for file names, commands and git words, which the scorer does not look for.
4. Start a different agent with the judge's brief above, with `examples/live-run/update-checklist.md` as the checklist and `examples/personas/austin-update.md` as the persona's brief.
5. Read the report and spot-check its quotes, as above.
6. Build the comment and post it as in step 6 above, on the issue the update run tests, or on the PR when there is no issue.
