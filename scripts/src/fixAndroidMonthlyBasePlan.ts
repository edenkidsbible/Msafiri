/**
 * Corrects the Android monthly product store identifier to msafiri_monthly:free-monthly.
 * The base plan ID in Google Play Console is "free-monthly", not "monthly".
 *
 * Previous state:  $rc_monthly → msafiri_monthly:monthly  (wrong base plan)
 * Target state:    $rc_monthly → msafiri_monthly:free-monthly  (correct base plan)
 */

import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listProducts,
  createProduct,
  updateProduct,
  listOfferings,
  listPackages,
  getProductsFromPackage,
  detachProductsFromPackage,
  attachProductsToPackage,
  listEntitlements,
  getProductsFromEntitlement,
  attachProductsToEntitlement,
} from "@replit/revenuecat-sdk";

const PROJECT_ID     = process.env.REVENUECAT_PROJECT_ID!;
const ANDROID_APP_ID = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID!;

// The product we just created (wrong base plan) → needs to be replaced
const WRONG_IDENTIFIER   = "msafiri_monthly:monthly";
// The correct identifier matching Google Play Console base plan "free-monthly"
const CORRECT_IDENTIFIER = "msafiri_monthly:free-monthly";

async function run() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. Fetch all Android products ─────────────────────────────────────────
  const { data: allProds } = await listProducts({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 40, app_id: ANDROID_APP_ID },
  });
  const items = allProds?.items ?? [];

  const wrongProd   = items.find((p) => p.store_identifier === WRONG_IDENTIFIER);
  let correctProd   = items.find((p) => p.store_identifier === CORRECT_IDENTIFIER);

  console.log("Wrong product  :", wrongProd?.id ?? "(not found)", WRONG_IDENTIFIER);
  console.log("Correct product:", correctProd?.id ?? "(not found)", CORRECT_IDENTIFIER);

  // ── 2. Create correct product if needed ───────────────────────────────────
  if (!correctProd) {
    // If the wrong product holds the display name "Msafiri Monthly", rename it first.
    if (wrongProd && wrongProd.display_name === "Msafiri Monthly") {
      const { error } = await updateProduct({
        client,
        path: { project_id: PROJECT_ID, product_id: wrongProd.id },
        body: { display_name: "Msafiri Monthly (wrong base plan)" },
      });
      if (error) throw new Error("Failed to rename wrong product: " + JSON.stringify(error));
      console.log("✓ Renamed wrong product to free display name");
    }

    const { data: created, error } = await createProduct({
      client,
      path: { project_id: PROJECT_ID },
      body: {
        store_identifier: CORRECT_IDENTIFIER,
        app_id: ANDROID_APP_ID,
        type: "subscription",
        display_name: "Msafiri Monthly",
        title: "Msafiri Monthly",
      },
    });
    if (error || !created) throw new Error("Failed to create correct product: " + JSON.stringify(error));
    correctProd = created;
    console.log(`✓ Created correct product: ${correctProd.id} (${CORRECT_IDENTIFIER})`);
  }

  // ── 3. Resolve $rc_monthly package ────────────────────────────────────────
  const { data: offerings } = await listOfferings({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 20 },
  });
  const currentOffering = offerings?.items.find((o) => o.is_current);
  if (!currentOffering) throw new Error("No current offering");

  const { data: pkgsData } = await listPackages({
    client,
    path: { project_id: PROJECT_ID, offering_id: currentOffering.id },
    query: { limit: 20 },
  });
  const monthlyPkg = pkgsData?.items.find((p) => p.lookup_key === "$rc_monthly");
  if (!monthlyPkg) throw new Error("$rc_monthly package not found");
  console.log(`\n$rc_monthly package: ${monthlyPkg.id}`);

  // ── 4. Inspect current package contents ───────────────────────────────────
  const { data: pkgProds } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: currentOffering.id, package_id: monthlyPkg.id },
    query: { limit: 20 },
  });
  const inPackage = pkgProds?.items ?? [];
  console.log("Currently in package:");
  for (const item of inPackage) {
    const p = (item as any).product;
    console.log(`  ${p.store_identifier} (${p.id})`);
  }

  // Remove any wrong/old Android monthly products from the package
  const toDetach = inPackage
    .map((item: any) => item.product)
    .filter((p: any) => p.app_id === ANDROID_APP_ID && p.id !== correctProd!.id);

  if (toDetach.length > 0) {
    const { error } = await detachProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: monthlyPkg.id },
      body: { product_ids: toDetach.map((p: any) => p.id) },
    });
    if (error && !JSON.stringify(error).includes("not currently attached")) {
      throw new Error("Failed to detach: " + JSON.stringify(error));
    }
    console.log(`\n✓ Detached ${toDetach.length} wrong Android product(s): ${toDetach.map((p: any) => p.store_identifier).join(", ")}`);
  } else {
    console.log("\n– No wrong Android products to detach from package");
  }

  const alreadyCorrect = inPackage.some((item: any) => item.product?.id === correctProd!.id);
  if (!alreadyCorrect) {
    const { error } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: monthlyPkg.id },
      body: { products: [{ product_id: correctProd!.id, eligibility_criteria: "all" }] },
    });
    if (error) throw new Error("Failed to attach correct product: " + JSON.stringify(error));
    console.log(`✓ Attached msafiri_monthly:free-monthly to package`);
  } else {
    console.log("– Correct product already in package");
  }

  // ── 5. Add correct product to entitlement (keep all others) ───────────────
  const { data: ents } = await listEntitlements({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 20 },
  });
  const proEnt = ents?.items.find((e) => e.lookup_key === "pro");
  if (!proEnt) throw new Error("'pro' entitlement not found");

  const { data: entProds } = await getProductsFromEntitlement({
    client,
    path: { project_id: PROJECT_ID, entitlement_id: proEnt.id },
    query: { limit: 20 },
  });
  const entProdIds = (entProds?.items ?? []).map((p: any) => p.id);

  if (!entProdIds.includes(correctProd!.id)) {
    const { error } = await attachProductsToEntitlement({
      client,
      path: { project_id: PROJECT_ID, entitlement_id: proEnt.id },
      body: { product_ids: [correctProd!.id] },
    });
    if (error) throw new Error("Failed to attach to entitlement: " + JSON.stringify(error));
    console.log(`✓ Attached msafiri_monthly:free-monthly to 'pro' entitlement`);
  } else {
    console.log("– Correct product already in 'pro' entitlement");
  }

  console.log("\n✅ Done. $rc_monthly → msafiri_monthly:free-monthly for Android.");
}

run().catch(console.error);
