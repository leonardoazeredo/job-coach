---
name: pipeline-board
description: Show the job pipeline as it stands. Use at the start of a session, or when the user asks for the pipeline, status, what's pending, what's stale, or who to follow up with. Read-only view computed from the pipeline folders.
---

# Pipeline board

Compute the board from files. Never reconstruct it from the conversation.

## Read first
- Nothing by hand. The board is computed by `scripts/board.ts` from every `pipeline/*/record.yaml` and `config/rules.yaml`.

## Steps

1. Run `node scripts/check.ts`. If it reports missing `profile/` files, the profile is not set up: run `node scripts/board.ts`, show its "Onboarding unfinished" list, and offer the onboarding skill. If the same run also reports other errors, show those under "Needs fixing" as well and stop after the list; a board over inconsistent records misleads. With no missing profile files, show any errors under "Needs fixing" and stop.
2. Run `node scripts/board.ts --today=<YYYY-MM-DD>` with today's date (state it). The script prints the board: roles tracked, interviews and conversations, identified roles not yet applied, waiting, stale, closed in the last 30 days, needs fixing, action items, and onboarding sections still unfinished.
3. Show the script's output as it is. Do not recount, regroup or add rows; if something looks wrong, fix the record through pipeline-update and run the script again.
4. Add at most three action items of your own only if the script's list has fewer than three: interviews needing prep, follow-ups due, stale roles to close.

Groups and thresholds live in `config/rules.yaml` (`board_groups`, `staleness`). Every status belongs to exactly one group; the script fails if one does not.

## Rules
- Only show salary if it is in the record. No ranges invented for tiers.
- A record with a missing or invalid field is listed under "Needs fixing" at the bottom, not silently dropped.
- Never write to files. Changes go through pipeline-update.
- Never reconstruct the board from the conversation or from memory of the files; the script is the only source.
