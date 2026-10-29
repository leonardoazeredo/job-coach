# A role CV reports one problem order, and evidence runs behind the variant

A role CV's problems come in one order: profile, folder, files, requirements, build, lint. Every operation on it (evidence, lint, write) reports the prefix of that list it depends on, and requirements are computed once, with the variant when one exists. So an evidence run on a role that already has a variant is blocked by an unreadable variant or by a bullet that answers an unknown requirement, which it never was before. We accepted that rather than computing requirements twice, or splitting the requirement problems into variant-dependent and not, because one computation keeps the three commands agreeing on what is wrong, and the blocked case is a role whose CV and requirements already disagree, fixed by one id.

## Considered options

- **Compute requirements without the variant for evidence**: rejected; it is the second code path this change removes.
- **Split requirement problems into two groups**: rejected; a wider interface to save a rare, cheap fix.
