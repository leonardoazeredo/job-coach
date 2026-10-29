# Experience bank: Brightwell Logistics, Feb 2021 to Oct 2023

Role id: `brightwell` (see `profile/history.yaml`). Fictional answers recorded for the example persona.

**Use.** Raw material only. Outward documents use approved wins from `profile/wins.yaml`.

## Section 1: Dock booking and the tracking-events table

### 1. What state was the tracking-events table in when you started on it?

Tags: performance, ownership-delivery

**Summary:** Every scan from every warehouse landed in one Postgres table that had never been pruned. The nightly vacuum ran into the morning shift, and dispatch screens slowed down while it ran. Nobody wanted to delete history because billing disputes sometimes needed scans from a year back.

<details><summary>Original answer</summary>

> It was one giant table, every scan since the company started. Vacuum was still going when the first shift clocked in, and dispatch would ping us about slow screens most mornings.

</details>

### 2. Who had a say in the overbooking rules for dock appointments, and how were they settled?

Tags: stakeholder-management, cross-functional-collaboration

**Summary:** Warehouse managers wanted no overbooking at all; carrier relations wanted plenty, because carriers often missed slots. Pulled six months of no-show rates per warehouse and proposed a setting each warehouse could choose for itself. The VP of operations made the call and approved the per-warehouse setting.

<details><summary>Original answer</summary>

> The managers and the carrier team both had a point, so I stopped arguing and pulled the no-show numbers. They were wildly different by site. A per-warehouse dial ended the argument, and the VP signed it off.

</details>

### 3. What was the hardest part of the cutover?

Tags: ownership-delivery

### 4. How did you agree the maintenance windows for the partition cutover with operations?

Tags: stakeholder-management, reliability

**Summary:** The cutover needed the table locked twice. Took a calendar of dock hours for each warehouse to the operations leads and showed which hours each option would block. They picked two Sunday-night windows; both cutovers finished inside them.

<details><summary>Original answer</summary>

> I could not promise zero impact, so I showed them exactly which dock hours each option touched. They chose two Sunday nights, and we finished early both times.

</details>
