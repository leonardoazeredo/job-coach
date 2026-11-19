# The Role CV stays behind the Workspace, read in role-folder.ts and checked in workspace.ts

A Role CV's files are read in `lib/role-folder.ts`, the one place every file in a role folder is read, and checked in `lib/workspace.ts` by `checkRoleCv`. That function runs files, requirements, build and lint once per handle, under a small `Need` policy (ADR 0004). Commands see only `Workspace.roleCv` and `Workspace.lintCvs` (ADR 0006). An architecture review proposed one Role CV module owning its reads, its order, its `Need` policy and its writes, with `role-folder.ts` shrunk to the record and events. We kept the current shape because that module fails the deletion test. Its interface would be the same `roleCv` and `lintCvs` the Workspace already offers, nothing in it would become simpler, and no knowledge is repeated across the two files today. All it would do is make `workspace.ts` shorter. The cost we accept is that `workspace.ts` holds several concerns side by side (identity and today, rules and the board, discovery, onboarding, the online copy and the Role CV), each behind its own method. Decided in #155.

## Considered options

- **A Role CV module behind the Workspace**: rejected because it moves code without concentrating it. The Workspace interface, the one problem order and the tests through `roleCv` and `lintCvs` would all stay the same.
- **Reading the CV files in that module instead of `role-folder.ts`**: rejected because `role-folder.ts` is the single reader of a role folder's files. A second reader would split how a role file is read across two modules.
- **Splitting `workspace.ts` by concern with no change of interface**: not taken up. No change so far has needed it. Reopen it when one does.
