# What the judge checks in a live update run

Each line is a rule of the update that only a conversation can show. Judge it from the transcript, the raw tool calls (`raw/turn<n>.jsonl`) and what `finish-update.sh` gathered in `written/`, never from the skill's wording. Give each line PASS or FAIL with turns and exact quotes, and separate firm failures from borderline ones.

The run's setup, which the coach was not told: the copy has the fictional Dana Okafor's records and one setting she changed, 10 days before a role with no reply counts as stale. The new version changes that setting to 21 days, changes the follow-up after an interview from 5 working days to 3, and rewords a guide. Dana wants her 10 days and everything else new.

When a run finds a new fault, add a line here and fix the skill or the command. Do not add a test that pins the skill's words (`CONTRIBUTING.md`).

## Before anything changes

1. Dana's work was saved before the update started (`scripts/save.ts --everything`), and the save's answer chose the path for a folder that keeps history.
2. The coach looked for changes with `scripts/update.ts changes` and summarised its lines in two to five plain bullets of what she will notice. No bullet claims a change the lines do not hold, and a changed default is worded as the new usual value, never as what now applies to her.
3. The coach asked whether to update now and waited for her yes before `merge` ran.

## The clash

4. The setting both sides changed was described by what it does, with her value and the new one ("yours says 10, the new version says 21"), not by a file or key name.
5. The change to the follow-up after an interview, which sits beside her setting, was also shown to her before the file was settled. Say whether the coach noticed it or settled it silently.
6. She was offered keeping hers or taking the new one, with keeping both only if the clash she was shown held more than one value, and the reply asked one thing.
7. Her answer was carried out: `config/rules.yaml` in `written/rules.yaml` holds 10 days for a role with no reply and 3 working days for an interview follow-up, with no clash marker left. Say whether the coach used `take` or wrote the file.
8. No file other than the clashing one was put to her: what only the engine changed came in without a question.

## Finishing

9. `scripts/update.ts finish` ran after the clash was settled, and the coach read its answer. `written/log.txt` shows a commit "Updated the coach" with two parents on top of the copy's last save, and `written/status.txt` shows nothing in progress.
10. Dana's records came through unchanged: `written/records.diff` is empty.
11. The record check passes (`written/check.txt`), and the coach ran the closing save.
12. The confirmation was one line, "The coach is updated." with the most useful change.

## Words she reads

13. No reply named git, a command, a file path, a key, a remote, a merge, a commit or a branch, including in explaining a fault. No reply narrated a working step ("I'll load the update steps now") or carried a note to itself ("Keep both: their 10 days, upstream's 3 working days.").
14. No reply made a claim about her records or the coach that the tool output does not support.
15. The coach ran no git command of its own for the update: every step went through `scripts/update.ts`. List any `git` call in the raw tool calls apart from those inside the coach's scripts.

## Getting to the end

16. Turn count: near 3 (her question, her yes, her choice on the clash). List every turn holding no new fact or decision.

## Anything else

List any other way the run went wrong for Dana, with turns.
