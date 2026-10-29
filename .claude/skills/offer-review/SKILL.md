---
name: offer-review
description: Review a job offer or contract and explain the package, including base, bonus, equity, RSUs, ESPP and pension, plus onboarding paperwork such as background checks, right to work and equipment. Use when the user receives an offer, contract or benefits document, or asks how a part of the user's compensation works.
---

# Offer review

Explain and check an offer. General information, not financial, tax or legal advice.

## Read first
- `pipeline/<slug>/record.yaml` and `events.md` (what was agreed verbally and when)
- The documents the user uploads (contract, offer letter, benefits sheet). Save copies or notes in `pipeline/<slug>/offer/`.
- `profile/identity.yaml` (compensation targets)
- `profile/history-private.yaml` (what a background check or reference call may report)

## Steps

1. **Extract terms** from the documents into `pipeline/<slug>/offer/terms.md`, each with the document and section it came from: title, start date, base, bonus, equity or RSU grant and vesting, ESPP, pension (employee and employer %), hours, office days, notice and probation, holiday, benefits.
2. **Compare** against what was agreed verbally (from `events.md` and the user's account). List matches, differences and anything missing.
3. **Explain the package** in plain numbers when the user asks: yearly and monthly gross, effect of salary sacrifice or ESPP contributions, vesting schedule by year. Show the formula and assumptions. Use current UK tax bands only if the user provides them or they are fetched from gov.uk with the date; otherwise say figures are approximate.
4. **Paperwork.** For background checks or document requests, list what is asked, what the user has, and draft one consolidated reply via correspondence.
5. **Log** "Offer" or "Accepted" via pipeline-update.

## Rules
- Quote the contract, do not paraphrase key terms.
- Point the user to a professional (accountant, solicitor) for decisions on pensions, tax residency or contract disputes.
- Do not answer from the documents of a different offer.
