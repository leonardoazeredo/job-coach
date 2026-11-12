---
name: experience-mining
description: Interview the user about a past role to capture detailed, first-hand material for the user's CV and interviews. Use when the user asks to be interviewed about a job, wants a question set to record answers to, or shares recorded answers or transcripts; cv-for-role also hands over targeted follow-up questions. Fills the experience bank and proposes new wins.
---

# Experience mining

Two phases: a question set the user records answers to, then ingestion of those answers.

## Read first
- `profile/history.yaml` (the role)
- `profile/wins.yaml` (existing wins for that role)
- `experience-bank/<role-id>.md` if it exists

## Phase 1: question set

1. Confirm the role (use the `id` from `history.yaml`).
2. Write 20 to 40 questions in 5 to 8 sections, numbered `<question>.<section>` so the user's recordings can be named to match (e.g. `3.1` = question 3, section 1). Cover: starting state and problems; what the user built and why; technical decisions and trade-offs; people (team, stakeholders, push-back, mentoring); measurable results and how they were measured; mistakes and what the user would do differently.
3. Ask for numbers wherever they might exist ("how many", "how long before and after").
4. Save as `experience-bank/<role-id>.md` with an empty answer slot under each question, and a `Tags:` line under each heading (ids from the competency pack, `config/competencies/<pack>.yaml` (the pack is `competency_pack` in `profile/identity.yaml`): competencies or themes).

## Phase 2: ingest answers

1. For each answer, keep the transcript in its original language, then add a 2 to 4 line English summary underneath, in the third person. The summary is not copied into a bullet as written. Never alter the original.
2. Mark facts that conflict with `history.yaml` or `wins.yaml` and ask which is right.
3. Propose wins: each with a slug, theme tags, the action, and a metric as the user approved it. Use `status: proposed`. The figure is written word for word as the user approved it; when what they said holds a first-person word or a note in brackets, put a CV-ready wording to them and let their yes make it the figure, its numbers and qualifiers never changing in that step. Where the user gave no number, write `metric: "Not specified"` rather than estimating.
4. Draft the proposed wins and changed facts with `node scripts/profile.ts draft profile/wins.yaml`, JSON on stdin: each win by `slug`, with `role`, `action`, `metric` as the user approved it, `status: proposed`, `themes`, `competencies` and any `never_say`. Relay the printed summary as it is, with at most one framing sentence. On the user's yes, run `node scripts/profile.ts write profile/wins.yaml`. The experience-bank notes of phase 2 are written directly, and the turn ends with `node scripts/save.ts`.

## Targeted follow-up (from cv-for-role)

cv-for-role asks a few questions for named evidence slots of one requirement. Save each answer the same turn:

1. Append to `experience-bank/<role-id>.md` under a section `## Follow-ups for <slug>, <date>`. Number questions after the file's last one (a file whose last question is 25 continues at 26); never renumber, because CVs cite `bank:<role-id>#<n>`.
2. Each entry: the question as a `### <n>. ...` heading, a `Tags:` line, `Asked for: <slug> <requirement id>`, the `**Summary:**`, and the original answer verbatim in a `<details>` block, as in phase 2. A "never happened" or "don't remember" answer is saved the same way.
3. Propose a win when an answer fills every slot of a competency: `status: proposed`, `competencies: [<id>]`, the metric quoted or `"Not specified"`. The bank entry's `Asked for:` line is what ties the win to its questions. Draft and write it as in phase 2 step 4, on the user's yes.
4. Flag answers that conflict with existing files; ask which is right.
5. Run `node scripts/check.ts`: it rejects unknown tags.

## Rules
- The experience bank is raw material; outward documents only use approved wins.
- No numbers are invented, rounded up or combined from different answers.
