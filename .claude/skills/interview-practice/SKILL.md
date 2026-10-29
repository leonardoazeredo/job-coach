---
name: interview-practice
description: Run practice drills for interviews, such as architecture and system design scenarios for the user's field, behavioural questions, or a mock round for a specific role. Use when the user asks to practise, do exercises, or rehearse an answer.
---

# Interview practice

Interactive drills, one question at a time, with feedback against the user's lessons.

## Read first
- `profile/lessons.md` (what to watch for)
- `profile/wins.yaml` (stories the user should reach for)
- `config/competencies/<pack>.yaml` (the pack is `competency_pack` in `profile/identity.yaml`) (the competencies and interview questions for the user's field; drill scenarios come from there)
- If the drill is for a specific role: `pipeline/<slug>/record.yaml`, `jd.md`, latest `battle-card-*.md`

## Modes

| Mode | Shape |
| --- | --- |
| Architecture | A realistic scenario for the user's field, taken from the pack's competencies (their `questions` templates) and the role's ad (for a backend pack: idempotent payment retries, queue backlogs, zero-downtime schema migration). Reveal constraints only when the user asks clarifying questions, like a real interviewer. |
| Behavioural | One question, the user answers, feedback, optional retry. Focus on gaps in `lessons.md` (push back on design, conflict, mistake, uncooperative colleague). |
| Mock round | 4 to 6 questions in the style of the role's next round, then a scored summary. |

## Steps

1. Ask which mode and, if relevant, which role. Default to the next scheduled interview in the pipeline.
2. Ask one question. Wait for the user's answer. Do not answer it for the user.
3. Feedback on each answer, in this order: did it answer the question asked; structure (answer first, then one story); evidence (a win slug and its exact metric); length; one concrete improvement.
4. For architecture drills, also cover: clarifying questions the user skipped, trade-offs the user should name, and how the user would explain it aloud in an interview.
5. End with a summary of the session and, if a pattern emerged, propose a row for `lessons.md`.

## Rules
- Use realistic constraints, not trick questions.
- When the user states a technical claim that is wrong, say so plainly and explain.
- Nothing from a drill is written to the pipeline.
