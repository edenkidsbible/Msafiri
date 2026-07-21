/**
 * Replaces the Android monthly product in the $rc_monthly package.
 *
 * Root cause: the project was seeded with playStoreIdentifier "msafiri_monthly_access:monthly"
 * but the actual Google Play subscription product ID is "msafiri_monthly" (base plan "monthly").
 * RevenueCat omits a package from its v1 customer API entirely when the store identifier can't
 * be resolved in the connected store — so Android clients never received $rc_monthly at all.
 *
 * What this script does:
 *  1. Creates a new Android product record for "msafiri_monthly:monthly" if it doesn't exist.
 *  2. In the $rc_monthly package: removes the wrong product, adds the correct one.
 *  3. In the "pro" entitlement: keeps BOTH products so existing subscribers of
 *     msafiri_monthly_access (if any) retain access.
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

const PROJECT_ID    = process.env.REVENUECAT_PROJECT_ID!;
const ANDROID_APP_ID = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID!;

const OLD_IDENTIFIER = "msafiri_monthly_access:monthly";
const NEW_IDENTIFIER = "msafiri_monthly:monthly";

async function run() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. Ensure the new product record exists ───────────────────────────────
  const { data: allProds } = await listProducts({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 40, app_id: ANDROID_APP_ID },
  });

  let newProd = allProds?.items.find((p) => p.store_identifier === NEW_IDENTIFIER);
  const oldProd = allProds?.items.find((p) => p.store_identifier === OLD_IDENTIFIER);

  if (newProd) {
    console.log(`✓ New product already exists: ${newProd.id} (${NEW_IDENTIFIER})`);
  } else {
    // The display_name "Msafiri Monthly" is taken by the old product — rename it first.
    if (oldProd) {
      const { error: renameErr } = await updateProduct({
        client,
        path: { project_id: PROJECT_ID, product_id: oldProd.id },
        body: { display_name: "Msafiri Monthly (legacy - wrong identifier)" },
      });
      if (renameErr) throw new Error("Failed to rename old product: " + JSON.stringify(renameErr));
      console.log(`✓ Renamed old product to free up display name`);
    }

    const { data: created, error } = await createProduct({
      client,
      path: { project_id: PROJECT_ID },
      body: {
        store_identifier: NEW_IDENTIFIER,
        app_id: ANDROID_APP_ID,
        type: "subscription",
        display_name: "Msafiri Monthly",
        title: "Msafiri Monthly",
        // subscription duration is only valid for simulated (test-store) products;
        // for real Play Store products RevenueCat reads metadata from the store directly.
      },
    });
    if (error || !created) throw new Error("Failed to create product: " + JSON.stringify(error));
    newProd = created;
    console.log(`✓ Created new product: ${newProd.id} (${NEW_IDENTIFIER})`);
  }
  console.log(`Old product: ${oldProd?.id ?? "(not found)"} (${OLD_IDENTIFIER})`);

  // ── 2. Resolve the $rc_monthly package ───────────────────────────────────
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

  // ── 3. Inspect current package contents ──────────────────────────────────
  const { data: pkgProds } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: currentOffering.id, package_id: monthlyPkg.id },
    query: { limit: 20 },
  });
  const attachedInPackage = pkgProds?.items ?? [];
  console.log("Currently in package:");
  for (const item of attachedInPackage) {
    const p = (item as any).product;
    console.log(`  ${p.store_identifier} (${p.id}) app=${p.app_id}`);
  }

  const oldInPackage = attachedInPackage.find((item: any) => item.product?.id === oldProd?.id);
  const newInPackage = attachedInPackage.find((item: any) => item.product?.id === newProd!.id);

  // ── 4. Swap in the package ────────────────────────────────────────────────
  if (oldInPackage && oldProd) {
    const { error } = await detachProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: monthlyPkg.id },
      body: { product_ids: [oldProd.id] },
    });
    if (error && !(JSON.stringify(error).includes("not currently attached"))) {
      throw new Error("Failed to detach old product: " + JSON.stringify(error));
    }
    console.log(`\n✓ Detached old product (${OLD_IDENTIFIER}) from package`);
  } else {
    console.log(`\n– Old product not in package, nothing to detach`);
  }

  if (!newInPackage) {
    const { error } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: monthlyPkg.id },
      body: { products: [{ product_id: newProd!.id, eligibility_criteria: "all" }] },
    });
    if (error) throw new Error("Failed to attach new product: " + JSON.stringify(error));
    console.log(`✓ Attached new product (${NEW_IDENTIFIER}) to package`);
  } else {
    console.log(`– New product already in package`);
  }

  // ── 5. Entitlement: add new product (keep old for existing subscribers) ───
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
  console.log(`\n'pro' entitlement currently has ${entProdIds.length} product(s)`);

  if (!entProdIds.includes(newProd!.id)) {
    const { error } = await attachProductsToEntitlement({
      client,
      path: { project_id: PROJECT_ID, entitlement_id: proEnt.id },
      body: { product_ids: [newProd!.id] },
    });
    if (error) throw new Error("Failed to attach to entitlement: " + JSON.stringify(error));
    console.log(`✓ Attached new product to 'pro' entitlement`);
  } else {
    console.log(`– New product already in 'pro' entitlement`);
  }

  console.log("\n✅ Done. $rc_monthly package now uses msafiri_monthly:monthly for Android.");
  console.log("   msafiri_monthly_access:monthly retained on entitlement for existing subscribers.");
  console.log("   Force-close and reopen the production app to clear the RevenueCat SDK cache.");
}

run().catch(console.error);
