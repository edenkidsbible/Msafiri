import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  attachProductsToPackage,
  deleteEntitlement,
  detachProductsFromPackage,
  getProductsFromPackage,
} from "@replit/revenuecat-sdk";

const PROJECT_ID = "projae197094"; // Msafiri Kenya project
const OFFERING_ID = "ofrng588b286328";

const WEEKLY_PKG_ID  = "pkged8b989985c";
const MONTHLY_PKG_ID = "pkge5ba8be30ae";

// All Msafiri products in new project
const WEEKLY_ALL  = ["prodb841507d31", "prod8762a6436d", "prod8de9dfae02"]; // test, ios, android
const MONTHLY_ALL = ["prodce9cf4221b", "prodb7e6217e8f", "prod3c530fa1bd"]; // test, ios, android

// Stray entitlement created manually (lookup_key="Msafiri Kenya Access" - wrong key)
const STRAY_ENTITLEMENT_ID = "entldbc52cc471";

async function main() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. Delete the stray manually-created entitlement ──────────────────
  console.log("Deleting stray entitlement entldbc52cc471 ...");
  const { error: delErr } = await deleteEntitlement({
    client,
    path: { project_id: PROJECT_ID, entitlement_id: STRAY_ENTITLEMENT_ID },
  });
  if (delErr) console.warn("  Could not delete (may already be gone):", JSON.stringify(delErr));
  else console.log("  ✓ Stray entitlement deleted");

  // ── 2. Fix weekly package ─────────────────────────────────────────────
  console.log("\nFixing $rc_weekly package ...");
  const { data: weeklyItems } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: OFFERING_ID, package_id: WEEKLY_PKG_ID },
    query: { limit: 20 },
  });

  const attachedWeekly = (weeklyItems?.items ?? []).map((i: any) => i.product?.id).filter(Boolean);
  const missingWeekly  = WEEKLY_ALL.filter((id) => !attachedWeekly.includes(id));

  if (missingWeekly.length === 0) {
    console.log("  All products already attached");
  } else {
    console.log(`  Attaching ${missingWeekly.length} missing products: ${missingWeekly.join(", ")}`);
    const { error } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: WEEKLY_PKG_ID },
      body: { products: missingWeekly.map((id) => ({ product_id: id, eligibility_criteria: "all" as const })) },
    });
    if (error) console.error("  ✗ Attach failed:", JSON.stringify(error));
    else console.log("  ✓ Weekly package complete");
  }

  // ── 3. Fix monthly package ────────────────────────────────────────────
  console.log("\nFixing $rc_monthly package ...");
  const { data: monthlyItems } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: OFFERING_ID, package_id: MONTHLY_PKG_ID },
    query: { limit: 20 },
  });

  const attachedMonthly = (monthlyItems?.items ?? []).map((i: any) => i.product?.id).filter(Boolean);
  const missingMonthly  = MONTHLY_ALL.filter((id) => !attachedMonthly.includes(id));

  if (missingMonthly.length === 0) {
    console.log("  All products already attached");
  } else {
    console.log(`  Attaching ${missingMonthly.length} missing products: ${missingMonthly.join(", ")}`);
    const { error } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: MONTHLY_PKG_ID },
      body: { products: missingMonthly.map((id) => ({ product_id: id, eligibility_criteria: "all" as const })) },
    });
    if (error) console.error("  ✗ Attach failed:", JSON.stringify(error));
    else console.log("  ✓ Monthly package complete");
  }

  console.log("\n✅ Done. Run checkRevenueCat.ts to verify.");
}

main().catch(console.error);
