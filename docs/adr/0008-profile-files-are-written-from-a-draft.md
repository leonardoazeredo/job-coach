# Profile files are written from a Draft, through a root command

Every write to `profile/*` and `cv/master.json` goes through `scripts/profile.ts`: `draft <file>` takes the new values on stdin, merges them into the file (or into its template for a new file) by a table that names each key's label, kind and list id, parses the result back through the file's schema, keeps it in `.coach/drafts/` and prints a summary rendered from it; `write <file…>` writes that draft unchanged after the user's yes. Before this, the coach wrote these files by hand with heredocs, string splices and `sed`, and told the user what it meant to write in separate prose, so a colon inside a sentence could break a file and nothing tied the summary to the bytes. Now the summary and the file come from one value, so what is written is what was shown; the yes stays the coach's, and so does the save.

## How it applies ADR 0006

`profile` is a command over the folder itself, so it takes `(args, root, deps?)`: it changes files as text, keeps drafts beside them and needs the clock and stdin injected. It still opens a `Workspace` at the root for what it reads as records, the identity's locale and the record check, and runs that check in-process rather than spawning `check.ts` as `update` does. The `Workspace` stays read-only: it gained an `identity` reader and nothing that writes. A write is undone when the check finds an error that was not there before it, so a profile still being set up, with files yet to come, can be written one file at a time. Problems name the file they concern and are worded where the file is read (ADR 0002); exit codes come from the shared table (ADR 0003). Templates are engine files and are read beside the script, and the drafts sit in the git-ignored `.coach/`, so neither is user data (ADR 0007).

## Considered options

- **The coach passes the whole new text instead of values**: rejected for the YAML and JSON files, because the module could then neither say which values changed nor keep the user's comments, and the text is where the hand-written faults came from. The four markdown files have no keys, so they do take whole text.
- **The coach writes the summary itself**: rejected, because a summary written beside the file is the gap this closes; it can say one thing while the file holds another.
- **Drafts in the system's temp folder**: rejected, because a draft must outlive the turn that made it, until the user answers, and a temp folder can be emptied in between or differ between the processes that draft and write.
- **The Workspace form, `(args, workspace)`**: rejected, because the command writes files and a `Workspace` that writes would widen the interface every record command sees.
