# What the judge checks in a live run

Each line is a behaviour a real run once got wrong, or a rule of the coach that only a conversation can show. It is judged from the transcript, the written files and the raw tool calls, never from the skill's wording. Give each line PASS or FAIL with turns and exact quotes, and separate firm failures from borderline ones.

When a run finds a new fault in the conversation, add a line here and fix the skill. Do not add a test that pins the skill's words (`CONTRIBUTING.md`).

## Writing a file

1. Every write to `profile/*` and `cv/master.json` went through `scripts/profile.ts write`. Count the writes by method. By-hand writes to `config/competencies/` and `experience-bank/` are allowed; count them apart.
2. Each write followed the person's yes to that exact draft. List any write with no yes, and any draft changed after its yes.
3. A file's draft and its write fell in different turns. A turn holding the write of one file and the draft of another is allowed; list those apart.
4. Each summary was relayed whole: no line dropped, merged or reworded. Compare the `draft` output in the raw calls with the reply that followed.
5. A summary carried at most one framing sentence of the coach's, plus one sentence for each note the skill asks for (where a value went, or that one was left out). No framing or note named a command, a tool or printing.
6. Every value written traces to a summary the person said yes to, apart from the kinds `scripts/lib/draft-table.ts` marks exempt. Give approximate traced and total counts and a table of failures.
7. A value given in part stayed in part: no month, place, product, level or "only" was added. The CV's headline is the one the source wrote.
8. A location or course start the source lacks was asked once; "none" became `null`, never an empty string.
9. A refused draft was put to the person as what the coach needed, with no file or key named and no value or `null` invented.

## Asking

10. Each reply asked one thing. An offer never shared a reply with a question or a summary. A yes on a summary counts as the one thing, and the wording-and-overclaim question counts as one.
11. Identity answers the source or an earlier answer settled were not asked again, and still appeared in a summary for a yes.
12. An inferred value stayed a question, except the timezone (follows from a stated city, shown and not asked), the coaching language (the language the person writes in) and the discipline when the CV or an earlier answer states it.
13. A level already given was not asked again, and the countries the person named were not followed by a question about others.
14. These were each asked, or the coach said plainly they were left out: tool names, things never done, payroll title (if the private section was opted into), earliest start, and which title words show their kind of work (`discovery.field_terms`).
15. No question was asked that has no place in a file.

## Recording what the person meant

16. `fit.hard_limits` holds only what the person said rules a role out. A preference went into `ideal_role_criteria` in their words or was left out, and the coach said which.
17. A condition on a title stayed with it in their words, or the coach said it was left out.
18. Pronouns reached `coach.md` and nowhere else.
19. A career gap was asked about or left out. The coach never stated that the person has no gaps.
20. A competency pack's labels on file are the ones the person last saw, with each `id` kept.

## Achievements

21. Each achievement got one question covering both the wording and the overclaim.
22. A reply answering only part got the other part asked alone in the next reply, with no part lost.
23. A metric was written word for word, qualifiers included. An outcome the person gave was recorded.
24. An achievement with nothing to change spent no further turn beyond its summary.
25. `status: approved` was set only on the yes to that summary.

## Words the person reads

26. No reply named a tool, a working step, a file or a key, including in explaining a fault, or called a summary "the draft". No template comment reached the person or a written file.
27. The coach said "achievement" and "priority", never "win" or "tier".
28. An achievement was named by its words, never by a number or an ordinal, even in passing.
29. Questions held no machine codes.
30. The coach stated no reason on the person's behalf that they did not give, in a framing sentence or anywhere else.

## Getting to the end

31. Setup checks ran before the CV was asked for, the coach's packages were installed, and each warning was shown.
32. The lessons list was first drafted once the optional section began, beside the last summary of that section, so one yes covered both. A yes to only one wrote what was agreed and asked about the list once more.
33. The glossary was offered in a reply of its own, after the lessons list was settled.
34. "Nothing is left" was said only when no draft or offer was waiting, and never in the reply making an offer.
35. The file checks passed at the end, and required sections were complete.
36. Turn count: near 65 to 70. Say where the turns went by section, and list every turn holding no new fact.

## Anything else

List any other way the run went wrong for this person, with turns.
