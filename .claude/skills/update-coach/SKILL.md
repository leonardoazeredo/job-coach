---
name: update-coach
description: Update the coach itself (its scripts, skills and default settings) to the newest version. Use when the user says "update the coach" or similar, or says yes to the start-of-session offer of a new version. Recording a change to a job is pipeline-update.
---

# Update the coach

Bring this folder's engine up to the newest `leonardoazeredo/job-coach` while the user's data stays exactly as it is. The user hears plain words only (see Plain words in CLAUDE.md): "a new version of the coach", "your settings", "saved". Every command's output is read here and summarised.

When the user asks whether a new version exists, run `node scripts/update.ts check --now`. It prints `available`, `latest`, or one plain sentence when the coach could not get an answer (no internet, the update service busy, or an unreadable reply); say that sentence in one line and offer to try again later. Updating is never started from a sentence.

## 1. Save first, and learn which path this folder takes

Run `node scripts/save.ts --everything "Saved before updating the coach"`.

- `not saved: this folder keeps no history`: take the **Without history** path below.
- `not saved: a check refused the save`: a fault in a file you wrote earlier in this same turn follows the Saving rule in `CLAUDE.md`. Otherwise stop. Say in one sentence what is wrong and that the update waits until it is fixed; offer the fix and change no file until the user says yes to that fix. An instruction given before the fault was named ("just get it done", "fix whatever is in the way") is not that yes. Any other record is the user's, so the fix is theirs to approve, even when the cause is plain, such as a misspelled status.
- Anything else (`saved; the online copy is up to date`, `saved on this computer`, `…the online copy waits…`, `…updating the online copy failed`, `nothing new to save`): take the **With history** path. A held or failed online copy does not stop the update; the work is safe on this computer.

Done when the save has answered and the path is chosen.

## With history

Each step below is one `node scripts/update.ts` command; read its first line.

### 2. Look for changes

Run `node scripts/update.ts changes`.

- `latest`: say "You're on the latest version of the coach." and stop.
- `not fetched: …`: say the coach could not reach the internet to look for a new version, and stop.
- `available`, then one `- ` line per change: summarise those lines in two to five plain bullets of what the user will notice (new abilities, fixed problems, changed defaults), then ask: "Update now?" A no ends the skill with nothing changed. Word a changed default as the new version's usual value ("the usual wait before a role with no reply counts as stale goes from 14 to 21 days"), because a setting the user changed stays theirs until step 3 settles it.

### 3. Merge

Run `node scripts/update.ts merge`.

- `merged`: go to step 4.
- `clashes: <files>`: the user or the coach edited each of these files, and so did the new version. Take them one at a time. The file now holds, between clash markers, the user's version under `yours`, the version both started from under `before`, and the new one under `new version`. A value that matches `before` was never changed on that side: say so ("you never changed this one; the usual 5 becomes 3"), and credit the user only with what they changed. Read them and describe each difference in the block by what it does ("how many days before a role counts as stale: yours says 21, the new version says 14"), including one the user never changed that sits beside theirs, then offer three choices. Ask even when the user said earlier what they want: their yes covers only what they have read. Every sentence of the reply is addressed to the user.
  - **Keep yours**: `node scripts/update.ts take ours <file>`.
  - **Take the new one**: `node scripts/update.ts take theirs <file>`.
  - **Keep both**: write the file with the user's changed values and everything new from the other side, with no clash markers left.

  A file one side removed holds no markers. Describe it as "you changed it, and the new version removes it" (or the other way round) and offer only the first two choices.

  Each `take` prints the clashes still left. Once every file is settled, go to step 4.
- `not merged: …` or `not fetched: …`: say in one line that the update could not start and nothing changed.

If the user wants to stop at any point before step 4, run `node scripts/update.ts cancel` and say in one line that the update was cancelled and nothing changed.

### 4. Finish

Run `node scripts/update.ts finish`. It saves the update, installs the coach's tools when they changed, and checks the records.

- `updated`: go to step 5.
- `clashes left: <files>`: a file is still unsettled, because it holds clash markers or one side removed it and no choice was taken. Settle it as in step 3 and run `finish` again.
- `not committed: …`: the update was cancelled and nothing changed. Say so in one line.
- `undone: …`: the new version did not work with this folder, so everything was put back. Say so in one line and offer to write a short problem report for the coach's authors from the check's output.
- `not undone: …`: the new version did not work with this folder and could not be taken back out. Say so in one line, say their information is safe in this folder's history, and offer to write a problem report for the coach's authors from the output. Change no file until the user answers.

### 5. Confirm

Run `node scripts/save.ts "Updated the coach"`; the update is already saved here, and this sends it to a private online copy. Read its first line as in Saving in CLAUDE.md: `nothing new to save` here means the online copy already had it. Confirm in one line: "The coach is updated." and one sentence with the most useful change, or with what was kept when a clash was settled.

## Without history

### 2. Download and replace

Run `node scripts/update.ts zip`. It downloads the newest coach, replaces only the coach's own files (user data folders stay byte-for-byte as they are), copies each replaced file into a backup folder under `.coach/backups/` first, runs the record check, and undoes everything if the check fails. Read its first line:

- `latest`: say "You're on the latest version of the coach."
- `updated: N replaced, M added; backup in <folder>`: confirm in one line that the coach is updated. When the line ends `; settings replaced: <files>`, name each file and ask whether the user had changed it; for each yes, copy `<backup folder>/<file>` over the same path in this folder, then run the record check.
- `not started: …`: the user's records fail the check before anything changed. Say what is wrong in one sentence (from stderr) and offer to fix it, then update.
- `undone: …`: the new version did not work with this folder, so every file was put back. Say so in one line and offer to write a short problem report for the coach's authors from the check's output.
- `not fetched: …`: say the coach could not fetch the new version (most often no internet connection) and that nothing changed.
