---
name: update-coach
description: Update the coach itself (its scripts, skills and default settings) to the newest version. Use when the user says "update the coach" or similar, or says yes to the start-of-session offer of a new version. Recording a change to a job is pipeline-update.
---

# Update the coach

Bring this folder's engine up to the newest `leonardoazeredo/job-coach` while the user's data stays exactly as it is. The user hears plain words only (see Plain words in CLAUDE.md): "a new version of the coach", "your settings", "saved". Every command's output is read here and summarised.

## 1. Save first, and learn which path this folder takes

Run `node scripts/save.ts --everything "Saved before updating the coach"`.

- `not saved: this folder keeps no history`: take the **Without history** path below.
- `not saved: a check refused the save`: stop. Say in one sentence what is wrong and that the update waits until it is fixed; offer to fix it.
- Anything else: take the **With history** path.

Done when the save has answered and the path is chosen.

## With history

### 2. Connect and fetch

Find the engine's name in this folder: `git remote -v`, and pick the name whose URL is `github.com/leonardoazeredo/job-coach` (onboarding names it `upstream`). With none, run `git remote add upstream https://github.com/leonardoazeredo/job-coach.git`. Below, `upstream` stands for that name.

Run `git fetch -q upstream main`. If it fails, say the coach could not reach the internet to look for a new version and stop. If `git merge-base --is-ancestor upstream/main HEAD` succeeds, say "You're on the latest version of the coach." and stop.

### 3. Summarise and ask

Note `BEFORE=$(git rev-parse HEAD)`. A **first update** is one where `git merge-base HEAD upstream/main` prints nothing: the folder was copied with "Use this template" and shares no history with the engine yet.

- First update: read `git log --no-merges --format='%ad %s' --date=short --since=<date of this folder's first commit> upstream/main` (first commit: `git log --reverse --format=%ad --date=short | head -1`).
- Otherwise: read `git log --no-merges --format=%s HEAD..upstream/main`.

Summarise in two to five plain bullets of what the user will notice (new abilities, fixed problems, changed defaults), then ask: "Update now?" A no ends the skill with nothing changed.

### 4. Merge

Run `git merge --no-commit --no-ff upstream/main`, adding `--allow-unrelated-histories` on a first update. Then list clashes with `git diff --name-only --diff-filter=U`.

On a first update every engine file that changed upstream since the copy clashes, even ones nobody touched. For each clashing file, compare this folder's version with the one in its first commit (`git rev-list --max-parents=0 HEAD`): when they are identical, nobody edited it, so take the new one silently with `git checkout --theirs -- <file> && git add <file>`.

For each clash that remains, the user or the coach edited that file. Read both sides and describe the difference by what it does ("how many days before a role counts as stale: yours says 21, the new version says 14"), then offer three choices:

- **Keep yours**: `git checkout --ours -- <file>`.
- **Take the new one**: `git checkout --theirs -- <file>`.
- **Keep both**: write the file with the user's changed values and everything new from the other side, with no clash markers left.

Then `git add <file>`. Done when `git diff --name-only --diff-filter=U` prints nothing; then `git commit --no-edit -m "Updated the coach"`.

If the user wants to stop, or the merge or the commit fails at any point, run `git merge --abort` and confirm with `git status` that no merge is in progress. Say in one line that the update was cancelled and nothing changed.

### 5. Install and check

If `git diff --quiet "$BEFORE" HEAD -- package-lock.json` fails, the coach's tools changed: run `npm ci`. Then run the record check: `node scripts/check.ts`, or `node scripts/check.ts --root examples/austin-backend` when `profile/identity.yaml` does not exist yet.

If either fails, undo the update with `git reset --keep "$BEFORE"`, and run `npm ci` again if the lockfile had changed. Say in one line that the new version did not work with this folder and was undone, and offer to write a short problem report for the coach's authors from the check's output.

### 6. Confirm

Run `node scripts/save.ts "Updated the coach"`; this sends the update to a private online copy too. Confirm in one line: "The coach is updated." plus the most useful change from step 3.

## Without history

### 2. Download and replace

Run `node scripts/update.ts zip`. It downloads the newest coach, replaces only the coach's own files (user data folders stay byte-for-byte as they are), copies each replaced file into a backup folder under `.coach/backups/` first, runs the record check, and undoes everything if the check fails. Read its first line:

- `latest`: say "You're on the latest version of the coach."
- `updated: N replaced, M added; backup in <folder>`: confirm in one line that the coach is updated. When the line ends `; settings replaced: <files>`, name each file and ask whether the user had changed it; for each yes, copy `<backup folder>/<file>` over the same path in this folder, then run the record check.
- `not started: …`: the user's records fail the check before anything changed. Say what is wrong in one sentence (from stderr) and offer to fix it, then update.
- `undone: …`: the new version did not work with this folder, so every file was put back. Say so in one line and offer to write a short problem report for the coach's authors from the check's output.
- `not fetched: …`: say the coach could not fetch the new version (most often no internet connection) and that nothing changed.
