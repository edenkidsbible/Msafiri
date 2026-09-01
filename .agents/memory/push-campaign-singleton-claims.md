---
name: Push campaign singleton claims
description: Prevent duplicate timed and scheduled push campaigns across multiple production workers.
---

Timed campaigns must claim their campaign type atomically in a database transaction before sending. Scheduled campaign workers must atomically transition a row from `scheduled` to `sending` and only the winning worker may deliver it. Recipient queries should group by stable vendor identity with installation/device identity as the fallback.

**Why:** A read-then-insert guard works in one process but races when multiple production workers enter the same notification window. Likewise, selecting due scheduled rows before an unconditional update lets every worker send the same campaign.

**How to apply:** Any new recurring or scheduled push path must have a database-backed single-winner claim before calling the Expo sender. In-memory duplicate suppression is only a final same-process safeguard, never the primary lock.