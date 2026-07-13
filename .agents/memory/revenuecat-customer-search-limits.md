---
name: RevenueCat customer search limitations
description: Why subscriber search/lookup in the RevenueCat proxy can't be email-based or fuzzy.
---

RevenueCat's v2 API (via the connectors proxy: `/v2/projects/{id}/customers`) has no
bulk search/filter endpoint — only list-all (paginated) and exact lookup by
`app_user_id` at `/v2/projects/{id}/customers/{app_user_id}`. There is no email
field on the customer object in this project's mapped response.

**Why:** a global-search feature that needed to search subscribers "by email"
had to be redefined to search by exact `app_user_id` instead, gated to
queries with no whitespace (to avoid firing implausible lookups on every
keystroke).

**How to apply:** any future feature needing to find a RevenueCat customer by
partial text/email must either maintain a local mirror table synced from
RevenueCat, or accept exact-app-user-id-only lookup as the ceiling.
