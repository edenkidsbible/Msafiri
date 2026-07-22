/**
 * revertToMonthlyAccess.ts
 *
 * Swaps the Android product on the $rc_monthly package back to
 * msafiri_monthly_access:monthly (Play-validated, duration=P1M) and
 * removes msafiri_monthly:free-monthly from that package.
 */

import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  getProductsFromPackage,
  attachProductsToPackage,
  detachProductsFromPackage,
} from "@replit/revenuecat-sdk";

const PROJECT_ID   = process.env.REVENUECAT_PROJECT_ID!;
const OFFERING_ID  = "ofrng588b286328";    // default offering
const PACKAGE_ID   = "pkge5ba8be30ae";     // $rc_monthly
const WRONG_ID     = "prodf7c81e455f";     // msafiri_monthly:free-monthly
const CORRECT_ID   = "prod6f151ef4ac";     // msafiri_monthly_access:monthly

async function main() {
  const client = await getUncachableRevenueCatClient();

  // 1. Read current state
  console.log("Fetching current $rc_monthly products…");
  const { data: current, error: err1 } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: OFFERING_ID, package_id: PACKAGE_ID },
    query: { limit: 20 },
  });
  if (err1) throw new Error("getProductsFromPackage failed: " + JSON.stringify(err1));

  const items = current?.items ?? [];
  const attachedProductIds = items.map((item: any) => item.product?.id as string);
  console.log("Attached product IDs:", attachedProductIds);

  // 2. Detach the wrong product
  if (attachedProductIds.includes(WRONG_ID)) {
    console.log("\nDetaching msafiri_monthly:free-monthly…");
    const { error } = await detachProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: PACKAGE_ID },
      body: { product_ids: [WRONG_ID] },
    });
    if (error) throw new Error("detach failed: " + JSON.stringify(error));
    console.log("  ✓ Detached");
  } else {
    console.log("  msafiri_monthly:free-monthly not found in package — skipping detach");
  }

  // 3. Attach the correct product
  if (!attachedProductIds.includes(CORRECT_ID)) {
    console.log("\nAttaching msafiri_monthly_access:monthly…");
    const { error } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: PACKAGE_ID },
      body: { products: [{ product_id: CORRECT_ID, eligibility_criteria: "all" as const }] },
    });
    if (error) throw new Error("attach failed: " + JSON.stringify(error));
    console.log("  ✓ Attached");
  } else {
    console.log("  msafiri_monthly_access:monthly already in package — no change needed");
  }

  // 4. Verify
  console.log("\nFinal state of $rc_monthly:");
  const { data: final } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: OFFERING_ID, package_id: PACKAGE_ID },
    query: { limit: 20 },
  });
  const APP_LABELS: Record<string, string> = {
    app04cc3ac658: "iOS",
    appd3493629e8: "Android",
    appda86a73f1a: "Test Store",
  };
  for (const item of final?.items ?? []) {
    const p = (item as any).product;
    const label = APP_LABELS[p?.app_id] ?? p?.app_id ?? "unknown";
    console.log(`  [${label}]  ${p?.store_identifier}  (${p?.id})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
