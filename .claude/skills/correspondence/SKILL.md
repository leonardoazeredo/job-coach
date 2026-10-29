---
name: correspondence
description: Draft a short reply or email to a recruiter, hiring manager or HR, such as scheduling, confirming, following up, thanking, withdrawing, declining or sending paperwork. Use when the user pastes a message and asks how to reply, or asks for a follow-up or withdrawal.
---

# Correspondence

Draft the message; never send it. Keep it short, warm and specific.

## Read first
- `pipeline/<slug>/record.yaml` and `events.md` (contacts, stage, last activity)
- `profile/identity.yaml` (timezone, availability)
- `profile/voice.md` (written register)

## Steps

1. **Log first.** If the incoming message changes the role's state (invite, reschedule, rejection, offer), run pipeline-update before drafting.
2. **Identify the type** and its pattern:
   | Type | Pattern |
   | --- | --- |
   | Scheduling | Thank them, offer or confirm slots with both timezones, confirm the medium |
   | Confirmation | One or two lines |
   | Follow-up (after `post_interview_follow_up_business_days` in config/rules.yaml post-interview, or by request) | Reference the last conversation, restate interest, one light question |
   | Thank-you after interview | One specific thing from the conversation, interest, nothing new to evaluate |
   | Withdrawal | Thanks, a decision, goodwill. No reason beyond "accepted another offer" or "decided to focus elsewhere" unless the user asks |
   | Rejection reply | Optional. Thanks, ask for feedback once, leave the door open |
   | Paperwork / HR | Facts only, one list of what is attached or missing |
3. **Match the channel.** A platform chat reply (e.g. Welcome to the Jungle) is 1 to 2 sentences, around 150 characters, no greeting block. Email gets a greeting, short body, sign-off with the user's name from `profile/identity.yaml`. Address people by the name in the message.
4. **Times.** Any time offered or confirmed is written in the recipient's timezone, with the user's own in brackets. If two slots could clash with other interviews in `pipeline/*/events.md`, warn the user.
5. **Show** the draft, then one line on anything the user should check (a date, an attachment).

## Rules
- Never invent a detail about a past conversation; quote from `events.md`, a transcript or a debrief, or leave it out.
- Keep the audience in mind: HR and coordinators get no technical detail.
- When a message changes a date, the draft and `events.md` must show the same date and timezone.
