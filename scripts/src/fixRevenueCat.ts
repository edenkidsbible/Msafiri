import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listEntitlements,
  updateEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  listPackages,
  getProductsFromPackage,
  detachProductsFromPackage,
  attachProductsToPackage,
  listProducts,
} from "@replit/revenuecat-sdk";

const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID!;
const TEST_APP_ID  = process.env.REVENUECAT_TEST_STORE_APP_ID!;
const IOS_APP_ID   = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;
const ANDROID_APP_ID = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID!;

// Msafiri product IDs discovered from checkRevenueCat.ts
const MSAFIRI_WEEKLY_PRODUCTS  = ["prod8d64cfa8fe", "prodb769b40ddd", "prodaf27995502"]; // test, ios, android
const MSAFIRI_MONTHLY_PRODUCTS = ["prod1763541c21", "prod8803712ee6", "proddcd4c6b1eb"]; // test, ios, android

const WEEKLY_PKG_ID  = "pkgead1fedc6ff";
const MONTHLY_PKG_ID = "pkgec2ed388a23";
const DEFAULT_OFFERING_ID = "ofrng26e04ec93a";
const ENTITLEMENT_ID = "entl9257b9d563";

async function main() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. Fix entitlement display name ────────────────────────────────────
  console.log("Fixing entitlement display name...");
  const { error: updateEntErr } = await updateEntitlement({
    client,
    path: { project_id: PROJECT_ID, entitlement_id: ENTITLEMENT_ID },
    body: { display_name: "Msafiri Access" },
  });
  if (updateEntErr) {
    console.warn("  Could not update entitlement display name (may not matter):", JSON.stringify(updateEntErr));
  } else {
    console.log("  ✓ Entitlement display name → 'Msafiri Access'");
  }

  // ── 2. Attach Msafiri products to the entitlement ─────────────────────
  console.log("Attaching Msafiri products to entitlement...");
  const allMsafiriProductIds = [...MSAFIRI_WEEKLY_PRODUCTS, ...MSAFIRI_MONTHLY_PRODUCTS];
  const { error: attachEntErr } = await attachProductsToEntitlement({
    client,
    path: { project_id: PROJECT_ID, entitlement_id: ENTITLEMENT_ID },
    body: { product_ids: allMsafiriProductIds },
  });
  if (attachEntErr) {
    console.error("  ✗ Failed to attach products to entitlement:", JSON.stringify(attachEntErr));
  } else {
    console.log("  ✓ Msafiri products attached to entitlement");
  }

  // ── 3. Fix Weekly package ──────────────────────────────────────────────
  console.log("\nFixing $rc_weekly package...");
  const { data: weeklyProds, error: weeklyErr } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: DEFAULT_OFFERING_ID, package_id: WEEKLY_PKG_ID },
    query: { limit: 20 },
  });
  if (weeklyErr) throw new Error("Failed to get weekly package products: " + JSON.stringify(weeklyErr));

  const weeklyProductIds = weeklyProds.items.map((item: any) => item.product?.id).filter(Boolean);
  const toDetachWeekly = weeklyProductIds.filter((id: string) => !MSAFIRI_WEEKLY_PRODUCTS.includes(id));

  if (toDetachWeekly.length > 0) {
    console.log(`  Detaching ${toDetachWeekly.length} non-Msafiri products: ${toDetachWeekly.join(", ")}`);
    const { error: detachErr } = await detachProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, offering_id: DEFAULT_OFFERING_ID, package_id: WEEKLY_PKG_ID },
      body: { product_ids: toDetachWeekly },
    });
    if (detachErr) console.error("  ✗ Detach failed:", JSON.stringify(detachErr));
    else console.log("  ✓ Old products detached");
  } else {
    console.log("  Nothing to detach from weekly package");
  }

  const alreadyAttachedWeekly = weeklyProductIds.filter((id: string) => MSAFIRI_WEEKLY_PRODUCTS.includes(id));
  const toAttachWeekly = MSAFIRI_WEEKLY_PRODUCTS.filter((id) => !alreadyAttachedWeekly.includes(id));

  if (toAttachWeekly.length > 0) {
    console.log(`  Attaching Msafiri weekly products: ${toAttachWeekly.join(", ")}`);
    const { error: attachErr } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: WEEKLY_PKG_ID },
      body: { products: toAttachWeekly.map((id) => ({ product_id: id, eligibility_criteria: "all" as const })) },
    });
    if (attachErr) console.error("  ✗ Attach failed:", JSON.stringify(attachErr));
    else console.log("  ✓ Msafiri weekly products attached");
  } else {
    console.log("  Msafiri weekly products already attached");
  }

  // ── 4. Fix Monthly package ─────────────────────────────────────────────
  console.log("\nFixing $rc_monthly package...");
  const { data: monthlyProds, error: monthlyErr } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: DEFAULT_OFFERING_ID, package_id: MONTHLY_PKG_ID },
    query: { limit: 20 },
  });
  if (monthlyErr) throw new Error("Failed to get monthly package products: " + JSON.stringify(monthlyErr));

  const monthlyProductIds = monthlyProds.items.map((item: any) => item.product?.id).filter(Boolean);
  const toDetachMonthly = monthlyProductIds.filter((id: string) => !MSAFIRI_MONTHLY_PRODUCTS.includes(id));

  if (toDetachMonthly.length > 0) {
    console.log(`  Detaching ${toDetachMonthly.length} non-Msafiri products: ${toDetachMonthly.join(", ")}`);
    const { error: detachErr } = await detachProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, offering_id: DEFAULT_OFFERING_ID, package_id: MONTHLY_PKG_ID },
      body: { product_ids: toDetachMonthly },
    });
    if (detachErr) console.error("  ✗ Detach failed:", JSON.stringify(detachErr));
    else console.log("  ✓ Old products detached");
  } else {
    console.log("  Nothing to detach from monthly package");
  }

  const alreadyAttachedMonthly = monthlyProductIds.filter((id: string) => MSAFIRI_MONTHLY_PRODUCTS.includes(id));
  const toAttachMonthly = MSAFIRI_MONTHLY_PRODUCTS.filter((id) => !alreadyAttachedMonthly.includes(id));

  if (toAttachMonthly.length > 0) {
    console.log(`  Attaching Msafiri monthly products: ${toAttachMonthly.join(", ")}`);
    const { error: attachErr } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: MONTHLY_PKG_ID },
      body: { products: toAttachMonthly.map((id) => ({ product_id: id, eligibility_criteria: "all" as const })) },
    });
    if (attachErr) console.error("  ✗ Attach failed:", JSON.stringify(attachErr));
    else console.log("  ✓ Msafiri monthly products attached");
  } else {
    console.log("  Msafiri monthly products already attached");
  }

  console.log("\n✅ Done. Run checkRevenueCat.ts to verify.");
}

main().catch(console.error);
