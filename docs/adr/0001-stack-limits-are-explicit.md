# Stack limits are explicit in stack.yaml, never inferred from brackets

A stack item that may only be claimed in a narrow sense (coursework only, report generation only, a graduate scheme) carries its limit as data in `profile/stack.yaml`: the roles where it may appear bare, and the exact phrase to use everywhere else. The CV lint enforces this in the skills list and job tech lists; bullet text is held to its cited sources instead. We do not parse the bracketed notes after item names, because the same brackets carry both limits ("Terraform (coursework)") and plain descriptions ("Elixir (6+ years)"), and no rule tells them apart reliably. Before this change the lint dropped the brackets altogether, so a CV could claim "Terraform" without its limit. Text that comes only from cv/master.json (projects, training, the default summary) is held to limits too: projects count as the `independent` role, the others as no role.

## Considered options

- **Infer limits from brackets**: rejected because descriptions and limits look the same.
- **Ban past and tools items from the skills list**: rejected because it is too blunt. It blocks truthful lines and misses limited items in secondary, such as Twilio, with client SMS integrations.
- **A separate `limits:` map**: rejected because the limit should sit next to the item, where agents read it.
