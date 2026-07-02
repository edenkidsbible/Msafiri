---
name: RevenueCat seed script project pinning
description: Why RevenueCat setup/seed scripts must never pick items[0] from listProjects when targeting an existing app's project.
---

The RevenueCat OAuth token used by `getUncachableRevenueCatClient()` can have access to multiple
projects on a shared/demo account (not just the one project belonging to the current app). A seed
script that does `listProjects().items[0]` to find "the" project can silently target a completely
unrelated project, creating duplicate entitlements/offerings/products there instead of updating the
real one.

**Why:** Ran into this directly — a pricing-update seed run picked an unrelated project (different
app entirely) as `items[0]` and created junk entitlement/offering/product data in it, while the
actual project the app's `EXPO_PUBLIC_REVENUECAT_*` keys point to was untouched. Confirmed via the
already-set `REVENUECAT_PROJECT_ID` env var, which named a different project than `items[0]`.

**How to apply:** Before running any RevenueCat seed/setup script against an existing app, check for
an existing `REVENUECAT_PROJECT_ID` (or equivalent stored project id) and pin project selection to
it. Only fall back to name-matching or "first project" for a brand-new app with no prior RevenueCat
setup, and even then, fail loudly (don't silently guess) if more than one project is visible to the
token.
