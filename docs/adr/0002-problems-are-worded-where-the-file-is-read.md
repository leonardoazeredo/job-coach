# Problems are worded where the file is read

Every data file in the workspace is read in one place, and that reader produces the problem for a file that is missing or unreadable, in one wording: `<file> is missing`, `<file> could not be read: <reason>`, `<file> slug "x" differs from the folder`. Callers (the record checker, the board, discovery, the CV commands) forward those problems and never annotate them; a consequence a command wants to explain, such as "listings for this role may show as new", belongs in that command's own output. Before this, one unreadable record was worded three ways, in the record checker, the board and discovery, and nothing downstream could match a message.

Missing is not always a problem. A record and its events are required, so their absence is reported at the read. Requirements and a variant are optional, so their absence is a fact the reader exposes, and an operation turns it into a problem only when it needs the file.

## Considered options

- **Annotate at the caller**: rejected because it is how the three wordings arose, and a skill or test cannot match one message.
- **Missing is always a problem**: rejected because a role without a CV is normal; the all-roles CV lint would flag every such role.
