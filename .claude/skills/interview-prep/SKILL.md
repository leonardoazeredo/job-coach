---
name: interview-prep
description: Build a battle card for an upcoming interview, with logistics, interviewer profile, stories to tell, likely questions with answers, and questions to ask. Use when the user asks for a battle card or prep, or when pipeline-board lists an interview under Prep due (window: `interview_prep_window_days` in config/rules.yaml).
---

# Interview prep

One battle card per interview, saved in the role's folder. Built from files and sourced research, never from chat memory.

## Read first
- `pipeline/<slug>/record.yaml`, `jd.md`, `events.md`
- `pipeline/<slug>/research.md` (run company-research first if missing or older than 14 days)
- Earlier `debrief-*.md` and `transcript-*.md` in the same folder (what was said, who comes next)
- `profile/wins.yaml`, `profile/lessons.md`, `profile/history.yaml`, `profile/voice.md` (spoken register)
- `profile/history-private.yaml`, for the risk check in step 8 only; nothing from it goes into the card's stories or answers

## Steps

1. **Confirm the interview.** From `events.md`: date, time and timezone, round, interviewer name and role, format (HR, hiring manager, technical, live coding, system design, founder). If any is missing, ask before writing the card.
2. **Profile the interviewer.** Use only what earlier transcripts said about them and what the user pastes (e.g. a LinkedIn summary). Label any guess about their focus as a guess.
3. **Pick themes.** 2 to 3 from the ad's responsibilities and the interviewer's likely focus (performance, modernisation, leadership, process, product impact, AI, design systems).
4. **Choose stories.** For each theme, one win slug with a measurable metric. Write it as STAR in the spoken voice: Situation (one line), Task, Action (the user's specific actions), Result (exact metric). Add a one-line trigger: which question it answers.
5. **Likely questions (defence).** Default 10; more on request. Each with a short answer outline pointing to a story. Always include:
   - "Tell me about yourself": 60 seconds, present, past, future.
   - "Why did you leave your last role?" using the public narrative in `history.yaml`.
   - The questions behind any open lesson in `lessons.md` (e.g. push back on design, a mistake).
6. **Questions to ask (offence).** Default 8; more on request. Tailored to the round: process and team for HR, roadmap and architecture for engineers, product and strategy for founders. Each must cite the fact from `jd.md` or `research.md` it builds on.
7. **Lessons to apply.** The 2 to 3 lessons from `lessons.md` most relevant to this format.
8. **Risk check.** If this is a late-stage round, or references or background checks are mentioned, add a private note if a public label differs from the payroll record (see `profile/history-private.yaml`). The note is for the user only.
9. **Write** `pipeline/<slug>/battle-card-<YYYY-MM-DD>.md` using the format below, then show a short summary and the file link.

## Battle card format

```
# <Company>, <round> with <interviewer>
<date> <time> <their tz> (<the user's tz>) · <format> · <length>

## The pitch (one line)
## Interviewer
## Stories
### <theme>: <win slug>
Trigger · S · T · A · R
## Likely questions
## Questions to ask
## Lessons to apply
## Logistics checklist (link, recording on, water, notes closed)
```

## Rules
- Preparation only. Never suggest hidden prompts, live AI assistance or answer sheets during the interview.
- Metrics exactly as in `wins.yaml`. Company facts only from `jd.md` or `research.md`, with the source link kept in research.md.
- If the user asks to "regenerate" or "expand", update the same file (append a version note) instead of creating a new one.
