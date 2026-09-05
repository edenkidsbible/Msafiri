---
name: Backup & Recovery system
description: How the device data backup/restore feature works — recovery codes, plate verification, data migration.
---

Email recovery must treat a verified recovery email as one account identity, not merely return a vehicle JSON blob.

**Why:** The old email flow could create empty linked backups and only changed the backup row's device ID. Recovery reported success while trips, places, contacts, and other durable records remained attached to the old identity.

**How to apply:** Link the email and current non-empty snapshot atomically. Restore under an email-scoped transaction lock, consume OTPs once, atomically count failed attempts, lock all source/destination rows, reject populated unrelated destinations, and migrate durable account tables in the same transaction.

Valid legacy snapshots under one email are merged by stable vehicle ID, newest version winning conflicts. Malformed rows are never overwritten or deleted automatically; if the destination row is malformed, abort without consuming the OTP.

**Why:** Selecting only the newest row can choose an empty snapshot, while deleting duplicate rows can destroy distinct vehicles or damaged evidence needed for manual repair.

**How to apply:** Prefer complete snapshots, allow an empty parseable snapshot only for partial recovery, merge every valid snapshot before consolidation, and retain malformed rows. The client must distinguish partial recovery and reload after identity migration.

Dashcam credentials and creator benefits are not automatically migrated.

**Why:** They have independent ownership/trust bindings; changing only their device ID can make clips inaccessible or transfer verified benefits incorrectly.

**How to apply:** Recover them only through a dedicated re-authorization or manually verified support process.
