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
> Every quote must be exact, because it will be spot-checked. Write the full report to `<run-dir>/judge-report.txt`, with a verdict line per checklist line at the top. Send back the path and those verdict lines.

## An update run

The same kind of proof for `update-coach` in a folder that keeps history. The fictional Dana Okafor (`examples/austin-backend`) has a copy made from this checkout's HEAD with one setting of her own, and updates to a local engine one version ahead that changed the same setting. It takes a few turns and costs well under $1.

1. Commit the change. Run `examples/live-run/start-update.sh <run-dir>` with the token in its environment, with a new folder outside this checkout as `<run-dir>`. It builds the copy and the engine, starts the container and installs the coach's packages.
2. Start one agent with the player's brief above, with `examples/personas/austin-update.md` as the brief to read and no nudge: drop the "Once only" paragraph. When it stops, it runs `examples/live-run/finish-update.sh <run-dir>` in place of `finish.sh`.
3. Run the scorer as above; for an update run it marks the line on the words she reads.
4. Start a different agent with the judge's brief above, with `examples/live-run/update-checklist.md` as the checklist and `examples/personas/austin-update.md` as the persona's brief.
5. Read the report and spot-check its quotes, as above.
