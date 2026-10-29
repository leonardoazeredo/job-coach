---
name: application-writer
description: Draft answers for a job application form, a "why us" statement, a cover note or a hiring-manager intro message. Use when the user pastes application questions or asks for a cover letter for a role already in the pipeline.
---

# Application writer

Draft what goes into an application, in the user's written voice (name and tone are in `profile/coach.md`), grounded only in the user's files and the role's record.

## Read first
- `pipeline/<slug>/record.yaml` and `jd.md` (run job-intake first if the role has no folder)
- `pipeline/<slug>/research.md` if it exists
- `profile/standard-answers.yaml`
- `profile/wins.yaml`, `profile/history.yaml` (public fields only), `profile/stack.yaml`
- `profile/voice.md` (written register)

## Steps

1. **Sort the questions.** For each field in the form:
   - Logistics (right to work, location, notice, salary, office days, years of experience, degree, links, convictions) → use `standard-answers.yaml` verbatim. If the form's options don't match the stored answer, pick the closest option and say so.
   - Yes/no screening questions → answer from the profile; if the truthful answer is "no", say so and flag it.
   - Free-text questions → step 2.
2. **Plan each free-text answer** before writing it:
   - What is the question really testing (motivation, product thinking, leadership, technical depth, domain)?
   - Which 1 to 2 win slugs answer it best? Prefer wins whose themes match the record's `hook` and the ad's responsibilities.
   - Which specific facts about the company can be used? Only those in `jd.md` or `research.md`.
   - Length: honour any stated limit ("2-3 sentences", "200-400 words", "no less than 200 words"). With no limit, aim for 80 to 150 words.
3. **Write** in the written voice: context, problem, action, outcome. Quote metrics exactly. At most one favourite phrase per answer.
4. **Self-check every answer** against this list before showing it:
   - Each metric matches `wins.yaml` word for word, including qualifiers.
   - No technology claimed that is not in `stack.yaml`; no `do_not_claim` item.
   - Titles, dates and employment type match `history.yaml` public fields.
   - No company fact that is not in `jd.md` or `research.md`.
   - Word count within the limit.
5. **Show** the answers in form order, each under its question, ready to paste. Under them, one line listing the win slugs used.
6. **Save** to `pipeline/<slug>/answers.md` with today's date. When the user says "sent" / "applied", hand over to pipeline-update.

## Intro messages to a hiring manager
Short (60 to 120 words), first person, one specific reason this company, one relevant win, one ask. No subject line unless it is an email.

## Rules
- A gap stays a gap. Use the adaptability framing in `stack.yaml` instead of implying experience (e.g. embedded firmware, COBOL).
- Salary: use `salary_expectation.<level>` in `standard-answers.yaml`, matching the levels in `identity.compensation.by_level` (one currency, `identity.compensation.currency`). If the top of the role's published band is below `identity.compensation.floor` (in `identity.compensation.currency`), flag it before answering.
- Background-check note: if the form asks for employment history details, references, or consent to a background check, add one private line to the user under the answers if a public label differs from the payroll record (see `profile/history-private.yaml`; do not open it here). The line is for the user, never part of an answer.
- Never re-use an answer from another company's `answers.md` without changing the company-specific parts.
