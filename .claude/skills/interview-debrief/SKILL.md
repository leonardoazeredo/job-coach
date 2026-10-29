---
name: interview-debrief
description: Analyse an interview after it happens, from a transcript, recording notes or the user's own account. Use when the user shares a transcript or says how an interview went. Records what happened, where the user gained and lost ground, the next step, and new lessons.
---

# Interview debrief

Turn an interview into a record, an honest assessment and lessons.

## Read first
- `pipeline/<slug>/record.yaml`, `events.md`, the latest `battle-card-*.md`
- `profile/lessons.md`, `profile/wins.yaml`

## Steps

1. **Store the source.** Save the transcript verbatim as `pipeline/<slug>/transcript-<YYYY-MM-DD>.md`. If it is partial, say which part is missing at the top. If there is no transcript, save the user's account as `notes-<date>.md`.
2. **Facts said in the interview.** Extract only what the transcript shows: interviewer names and roles, process and next rounds (who, format, timing), team size and setup, stack and problems mentioned, salary or level discussed. Quote short phrases. These go into `record.yaml` contacts and `events.md`.
3. **Assessment.** For each main question asked:
   - What the user answered (one line), whether it landed, and why, with a quote from the transcript.
   - Where an answer was vague, too long, or missed the question, show a tighter version using a win slug.
   - Be direct. Do not grade generously to reassure, and do not invent interviewer reactions.
4. **Next step.** Who is next and when, according to the transcript. If the transcript does not say, write "Not stated" and suggest asking the recruiter.
5. **Lessons.** Propose 1 to 3 new rows for `profile/lessons.md` (date, source, lesson). Append them after the user says yes.
6. **Write** `pipeline/<slug>/debrief-<date>.md` and log "Interview done" via pipeline-update.
7. **Reply** with three short parts: how it went (2 lines), top fixes (up to 3), next step.

## Rules
- Only the transcript and the user's account count as evidence. Never fill gaps from the battle card's assumptions.
- Keep the user's spoken words in their original language when quoting; summarise in English.
- After a rejection, a debrief is still worth doing when there is a transcript; skip it otherwise.
