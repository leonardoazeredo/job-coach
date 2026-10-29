---
name: pipeline-update
description: Record a change to a tracked role. Use when the user says they applied, sent, skipped or withdrew, or pastes a recruiter email, rejection, interview invite, reschedule or offer. Writes a dated event and updates the role's status.
---

# Pipeline update

Every change to a role becomes one line in `events.md` and an updated `record.yaml`, in the same turn.

## Read first
- `config/rules.yaml` (allowed statuses and event names)
- The matching `pipeline/<slug>/record.yaml` and `events.md`
- `profile/identity.yaml` (the user's timezone)

## Steps

1. **Find the role.**
   - "applied" / "sent" with no name means the role discussed last in this session. Say which one you assumed.
   - An email: match on company, then on the job title in the email. If the company has more than one open record and the email does not name the title, list the candidates and ask.
   - No record exists: run job-intake first if the user can paste the ad; otherwise create a minimal record (company, title, source) and note "JD not captured".
2. **Classify the event** as one name from `rules.yaml` `events`. `check.ts` rejects any other name.
3. **Times.** For any scheduled time, record the timezone exactly as written in the message. Show it back in both the sender's timezone and the user's own (from identity.yaml or as the user states). If the message gives no timezone, ask before writing it.
4. **Append** one row to `events.md`: date, time with tz, event, short detail (interviewer name, round, channel), source (email, WTTJ chat, portal).
5. **Update `record.yaml`:** status (only to a value in rules.yaml), `dates.applied` for every status in `rules.yaml` `implies_applied`, `dates.last_activity` (always the date of the newest event), `next_action` with a due date, new `contacts`, and `status_reason` for every status in `rules.yaml` `status_reason_required`.
6. **Check.** Run `node scripts/check.ts`. Fix every error it reports for the role before replying; never leave a record the checker rejects.
7. **Reply** in one or two lines: what changed and the next action. Offer a draft reply only if the message calls for one (hand over to correspondence).

## Rules
- Never change a role's status because of what was said many turns ago; only the current message or the files count.
- Never mark something Applied unless the user said so in the user's own words. A pasted board or summary that says "applied" is logged with source "unverified" and the user is asked. "Didn't apply" means Skipped with the user's reason.
- A rejection keeps any reason the company gave, quoted.
- Several roles in one message: one event per role, then a single combined reply.
