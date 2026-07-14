---
name: Community report "Gone now" single-vote quirk
description: denyReport/deny endpoint sets a report to "denied" on the very first vote, not after a threshold — different from confirm's 3-vote protection.
---

The mobile app's `denyReport` (AppContext) and the server's `POST /reports/:id/deny` ("Gone now" button) mark a report `denied` on the **first** deny vote from any device — there is no threshold, unlike the 3-confirm protection that guards self-delete (`DELETE /reports/:id` rejects if `confirmCount >= 3`).

**Why:** the comment in code says "server now denies on first vote" — an intentional real-time signal (any single credible "it's gone" report should hide a removed camera immediately), but it means any driver can single-handedly hide someone else's report through this vote UI, which is easy to conflate with the (separately built) admin-only "remove a report" moderation flow.

**How to apply:** when working on report deletion/moderation UX, don't assume "Gone now" and admin removal are the same permission tier — they are different mechanisms with different actors. If asked to make report removal admin-only, the deny-vote path is a pre-existing exception that needs an explicit decision (kept as differently-scoped community signal, not touched, in the case handled 2026-07-14), not an oversight to silently fix.
