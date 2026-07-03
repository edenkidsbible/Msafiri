---
name: RevenueCat shared-project app collision
description: A RevenueCat project can contain app_store/play_store app entries belonging to a different, unrelated app on the same account — matching by `type` alone silently targets the wrong one.
---

On a shared/demo RevenueCat account, a single project can hold app entries for multiple unrelated
products (e.g. two different mobile apps built on the same account). `apps.items.find(a => a.type ===
"play_store")` (or `"app_store"`) returns the *first* app of that type regardless of which product it
actually belongs to — there is no project-level uniqueness guarantee per store type.

**Why:** Found a production app's Android build crash-free but stuck on the paywall because its
`EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`/`IOS_API_KEY` were actually pointing at another live app's
RevenueCat app entries (wrong `package_name`/`bundle_id` entirely). This happened because an earlier
seed run picked the sole existing play_store/app_store app by type instead of by package identity, and
that entry belonged to a different app on the account.

**How to apply:**
- Never assume one app per store `type` in a project. Always match existing apps by bundle
  id/package name (or a pinned app-id env var) before falling back to creating a new one.
- If the matching app doesn't exist yet, create a *new* app entry scoped to the correct
  bundle id/package name rather than reusing an unrelated one — do NOT edit/rename another
  product's existing app entry, even if it's the only one of that type.
- The RevenueCat OAuth token is project-scoped and cannot create new top-level projects (see
  revenuecat-proxy-client.md), so multiple real products sharing one account must coexist as
  separate app entries within the same project, disambiguated by bundle id/package name.
