---
name: Legacy dump restore reconciliation
description: Safeguards for restoring an older production PostgreSQL dump into the current development schema.
---

After restoring an older production dump, inventory every non-empty `TABLE DATA` entry in the archive and compare its row count with the reconciled database. Restore any durable table whose rows disappeared during schema reconciliation.

**Why:** A schema push can drop a table that is absent from the declarative schema, after which startup migration code recreates it empty. Schema tools can also request truncation merely to add newly named unique constraints even when the historical data is already unique.

**How to apply:** Back up the target first. Never accept truncation prompts. Audit duplicates, add or attach compatible constraints without deleting rows, rerun schema reconciliation, restart the API, then compare all archive and database counts. Expired OTP/challenge rows may remain omitted, but durable customer records must match.