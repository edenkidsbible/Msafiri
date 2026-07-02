---
  name: RevenueCat test-store price replacement idempotency
  description: Test-store product prices can't be edited (no PATCH), and products with real transactions can't be deleted — seed scripts must converge on a stable replacement identifier, not a timestamp.
  ---

  RevenueCat's `test_store_prices` endpoint only supports POST(add)/GET(list) — there is no
  PATCH/PUT/DELETE. To "change" a price you must replace the product: detach it from its package,
  delete it, create a new product with the new price, and re-attach.

  Two failure modes to guard against:
  1. **Detaching the wrong product.** Don't assume the product matched by identifier lookup is the
     one currently attached to the package — a prior manual fix or partial run can leave a
     *different* product actually live in the package slot. Always call `getProductsFromPackage`
     to find what's really attached (filtered by `app_id`) and detach all of those before creating
     a replacement, or you'll hit "already another incompatible product attached" errors.
  2. **Undeletable products need a stable replacement identifier, not a timestamp.** If a product has
     real transaction history, `deleteProduct` fails permanently — every future seed run will hit the
     same stale price and same delete failure. If the replacement identifier is timestamp-based
     (e.g. `${identifier}_v${Date.now()}`), each run mints a brand new orphaned product forever
     instead of converging. Use a fixed deterministic fallback identifier (e.g. `${identifier}_fixed`)
     and look it up in the existing-products list first, so subsequent runs find and reuse it instead
     of creating duplicates.

  **Why:** Hit both of these back to back while fixing a stale KES price on a subscription product —
  first a failed attach because the wrong product was targeted for detach, then unbounded duplicate
  product creation because the replacement used `Date.now()` in its identifier.

  **How to apply:** Any RevenueCat seed/setup script that needs to change a test-store price on an
  existing product must (a) resolve currently-attached products via the package, not just by identifier
  match, and (b) use a deterministic fallback identifier for undeletable-product replacements, checking
  for its prior existence before creating.
  