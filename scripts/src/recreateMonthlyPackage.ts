/**
 * recreateMonthlyPackage.ts
 *
 * Deletes the stale $rc_monthly package and recreates it fresh so RevenueCat
 * rebuilds its v1 offering cache with a clean package record.
 *
 * Products re-attached after recreation:
 *   [Android]    msafiri_monthly_access:monthly  (prod6f151ef4ac)
 *   [iOS]        msafiri_monthly                 (prodb7e6217e8f)
 *   [Test Store] msafiri_monthly                 (prodce9cf4221b)
 */

import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  getPackage,
  deletePackageFromOffering,
  createPackages,
  attachProductsToPackage,
  getProductsFromPackage,
} from "@replit/revenuecat-sdk";

const PROJECT_ID  = process.env.REVENUECAT_PROJECT_ID!;
const OFFERING_ID = "ofrng588b286328";
const OLD_PKG_ID  = "pkge5ba8be30ae";  // existing $rc_monthly

// Products to re-attach after recreation
const PRODUCTS = [
  { product_id: "prod6f151ef4ac", label: "Android  msafiri_monthly_access:monthly" },
  { product_id: "prodb7e6217e8f", label: "iOS      msafiri_monthly" },
  { product_id: "prodce9cf4221b", label: "Test     msafiri_monthly" },
];

async function main() {
  const client = await getUncachableRevenueCatClient();

  // 1. Read current package metadata
  console.log("Reading existing $rc_monthly package…");
  const { data: existingPkg, error: readErr } = await getPackage({
    client,
    path: { project_id: PROJECT_ID, package_id: OLD_PKG_ID },
  });
  if (readErr) throw new Error("getPackage failed: " + JSON.stringify(readErr));
  console.log(`  lookup_key:   ${(existingPkg as any)?.lookup_key}`);
  console.log(`  display_name: ${(existingPkg as any)?.display_name}`);
  console.log(`  position:     ${(existingPkg as any)?.position}`);

  // 2. Delete the old package
  console.log("\nDeleting old $rc_monthly package…");
  const { error: delErr } = await deletePackageFromOffering({
    client,
    path: { project_id: PROJECT_ID, package_id: OLD_PKG_ID },
  });
  if (delErr) throw new Error("deletePackageFromOffering failed: " + JSON.stringify(delErr));
  console.log("  ✓ Deleted");

  // 3. Recreate it with same lookup_key
  console.log("\nRecreating $rc_monthly package…");
  const { data: newPkg, error: createErr } = await createPackages({
    client,
    path: { project_id: PROJECT_ID, offering_id: OFFERING_ID },
    body: {
      lookup_key: "$rc_monthly",
      display_name: "Monthly",
      position: 1,
    },
  });
  if (createErr) throw new Error("createPackages failed: " + JSON.stringify(createErr));
  const newPkgId = (newPkg as any)?.items?.[0]?.id ?? (newPkg as any)?.id;
  console.log(`  ✓ Created — new package ID: ${newPkgId}`);

  // 4. Attach all three products
  console.log("\nAttaching products…");
  const { error: attachErr } = await attachProductsToPackage({
    client,
    path: { project_id: PROJECT_ID, package_id: newPkgId },
    body: {
      products: PRODUCTS.map((p) => ({
        product_id: p.product_id,
        eligibility_criteria: "all" as const,
      })),
    },
  });
  if (attachErr) throw new Error("attachProductsToPackage failed: " + JSON.stringify(attachErr));
  for (const p of PRODUCTS) console.log(`  ✓ ${p.label}`);

  // 5. Verify via management API
  console.log("\nVerifying via management API…");
  const { data: verify } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: OFFERING_ID, package_id: newPkgId },
    query: { limit: 20 },
  });
  const APP_LABELS: Record<string, string> = {
    app04cc3ac658: "iOS",
    appd3493629e8: "Android",
    appda86a73f1a: "Test Store",
  };
  for (const item of verify?.items ?? []) {
    const p = (item as any).product;
    const label = APP_LABELS[p?.app_id] ?? p?.app_id ?? "unknown";
    console.log(`  [${label}]  ${p?.store_identifier}  (${p?.id})`);
  }

  // 6. Check the v1 customer API immediately after recreation
  console.log("\nChecking v1 customer API…");
  const v1res = await fetch(
    `https://api.revenuecat.com/v1/subscribers/$RCAnonymousID:msafiri_verify/offerings`,
    {
      headers: {
        Authorization: `Bearer goog_ooNOODiUZCkYXUFSBbDimjbtSHL`,
        "X-Platform": "android",
        "X-Platform-Version": "34",
        "X-Version": "7.0.0",
      },
    },
  );
  const v1json = await v1res.json() as any;
  const pkgs = v1json.offerings?.[0]?.packages ?? [];
  if (pkgs.length === 0) {
    console.log("  ⚠️  No packages in v1 response yet (may need a minute to propagate)");
  }
  for (const pkg of pkgs) {
    console.log(`  ${pkg.identifier}  →  ${pkg.platform_product_identifier}:${pkg.platform_product_plan_identifier}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
