---
name: role-triage
description: Screen a list of several job postings at once, from Cord, Welcome to the Jungle, Hacker News "Who's hiring", YC Work at a Startup or a pasted board page. Use when the user pastes or links many roles and wants the noise filtered out. Gives one line per role; full intake happens only for the ones the user keeps.
---

# Role triage

Fast, complete screening of a list. Every role gets a line, in the order given. No full extraction here.

## Read first
- `profile/stack.yaml` (core, secondary, do_not_claim)
- `profile/identity.yaml` (location, right to work, compensation floor)
- `config/rules.yaml` (fit rules, discovery title expansion and keywords)
- `pipeline/` folder names (already tracked or already applied)

## Steps

1. **Split the list** into individual roles. Number them in the order given and state the total ("Found 23 roles"). If the paste is cut off or a link cannot be fetched, say which ones are missing.
2. **Screen each role** on what the card shows, in this order, stopping at the first failure:
   1. Already in `pipeline/` → "Tracked (status)".
   2. Location or right to work impossible under `fit.location_rule` in `profile/search.yaml`.
   3. Hard gap: mandatory primary language or framework outside core and secondary, or a `do_not_claim` item.
   4. Published salary with a top end below the floor (`rules.yaml` fit.salary_test).
   5. Seniority clearly junior or mid.
   Otherwise **Keep** or **Maybe**. Titles in `discovery.title_expansion` and roles matching `agentic_keywords` are never dropped for the title alone.
3. **Output one table** with every role, none omitted:

```
| # | Company | Title | Verdict | Reason (one line) |
```

   Verdict is Keep, Maybe, Drop or Tracked. Then list the Keep roles in suggested order of priority with a one-line reason each.
4. **Stop.** Ask which roles to take forward. For each one the user picks, run job-intake (with the full ad if the card was only a summary).

## Rules
- The table row count must equal the total stated in step 1. Check before replying.
- A card summary is thin; "Maybe" is the right verdict when key facts are missing, not "Drop".
- Do not write anything to `pipeline/` in this skill.
