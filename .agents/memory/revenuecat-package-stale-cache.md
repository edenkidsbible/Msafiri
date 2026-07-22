---
name: RevenueCat package stale v1 cache
description: When RevenueCat's management API shows correct products but the v1 customer API (what the SDK actually calls) omits a package, delete and recreate the package to force a fresh v1 cache entry.
---

## The Rule
If `$rc_monthly` (or any package) appears correctly in the management API but is completely absent from the v1 customer API response, the package itself has stale/corrupted server-side state. **Delete the package and recreate it** — do not keep attaching/detaching products.

**Why:** RevenueCat's v1 customer API maintains a separate server-side cache per package entry. Multiple rapid attach/detach cycles on the same package ID can leave this cache in a broken state that no product change will fix. Deletion forces RevenueCat to build a clean cache entry on recreation.

**How to apply:**
1. Note the package's `lookup_key`, `display_name`, and `position` (via `getPackage`)
2. Note all attached product IDs (via `getProductsFromPackage`)
3. `deletePackageFromOffering` using the package ID
4. `createPackages` with the same `lookup_key`/`display_name` — this gets a new package ID
5. `attachProductsToPackage` with the new package ID
6. Verify the v1 API immediately: `GET /v1/subscribers/$RCAnonymousID:test/offerings` with the Android API key — the package should now appear

**Diagnostic signal:** Management API (v2) shows correct products; v1 customer API only returns other packages (e.g. `$rc_weekly` appears but `$rc_monthly` does not), and this persists across multiple product changes.

**Script:** `scripts/src/recreateMonthlyPackage.ts` — adapt for any package.
