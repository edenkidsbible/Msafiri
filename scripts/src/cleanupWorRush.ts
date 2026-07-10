import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listApps,
  listProducts,
  listEntitlements,
  listOfferings,
  listPackages,
  getProductsFromPackage,
  deleteApp,
  deleteProduct,
  deleteEntitlement,
  detachProductsFromPackage,
  deleteEntitlement as _deleteEntitlement,
} from "@replit/revenuecat-sdk";

const WORRUSH_PROJECT_ID = "projc48983a9";

// WorRush's own apps — DO NOT TOUCH these
const WORRUSH_OWN_APP_IDS = new Set([
  "app60e0dbdee0", // WorRush (App Store)
  "app952021177c", // WordRush Android
  "appdd8e47ffe4", // Test Store (was there before Msafiri)
]);

// Apps I added for Msafiri — DELETE these
const MSAFIRI_APPS_TO_DELETE = [
  { id: "appc07789336f", name: "Msafiri Kenya iOS" },
  { id: "appfbdd48a3b0", name: "Msafiri Kenya Android" },
];

// Entitlement I created for Msafiri in this project — DELETE
const MSAFIRI_ENTITLEMENT_ID = "entl9257b9d563"; // "Msafiri Access" / lookup_key="pro"

async function main() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. Show current state ────────────────────────────────────────────
  console.log("=== Current WorRush project state ===\n");

  const { data: apps } = await listApps({ client, path: { project_id: WORRUSH_PROJECT_ID }, query: { limit: 20 } });
  console.log("Apps:");
  for (const app of apps?.items ?? []) {
    const tag = WORRUSH_OWN_APP_IDS.has(app.id) ? "[KEEP]" : "[DELETE]";
    console.log(`  ${tag} ${app.name} (${app.id}) type=${app.type}`);
  }

  const { data: products } = await listProducts({ client, path: { project_id: WORRUSH_PROJECT_ID }, query: { limit: 100 } });
  console.log("\nProducts:");
  for (const p of products?.items ?? []) {
    const isMsafiri = !WORRUSH_OWN_APP_IDS.has(p.app_id) || p.store_identifier.includes("msafiri") || p.store_identifier.includes("safedrive");
    const tag = isMsafiri ? "[DELETE]" : "[KEEP]";
    console.log(`  ${tag} ${p.store_identifier} app=${p.app_id} id=${p.id}`);
  }

  const { data: entitlements } = await listEntitlements({ client, path: { project_id: WORRUSH_PROJECT_ID }, query: { limit: 20 } });
  console.log("\nEntitlements:");
  for (const e of entitlements?.items ?? []) {
    const tag = e.id === MSAFIRI_ENTITLEMENT_ID ? "[DELETE]" : "[KEEP/CHECK]";
    console.log(`  ${tag} "${e.display_name}" lookup_key="${e.lookup_key}" id=${e.id}`);
  }

  const { data: offerings } = await listOfferings({ client, path: { project_id: WORRUSH_PROJECT_ID }, query: { limit: 20 } });
  console.log("\nOfferings:");
  for (const o of offerings?.items ?? []) {
    console.log(`  offering: "${o.display_name}" id=${o.id}`);
    const { data: pkgs } = await listPackages({ client, path: { project_id: WORRUSH_PROJECT_ID, offering_id: o.id }, query: { limit: 20 } });
    for (const pkg of pkgs?.items ?? []) {
      const { data: pkgProds } = await getProductsFromPackage({
        client,
        path: { project_id: WORRUSH_PROJECT_ID, offering_id: o.id, package_id: pkg.id },
        query: { limit: 20 },
      });
      const ids = (pkgProds?.items ?? []).map((i: any) => i.product?.store_identifier).join(", ");
      console.log(`    package: ${pkg.lookup_key} (${pkg.id}) → products: [${ids}]`);
    }
  }

  console.log("\n=== Starting cleanup ===\n");

  // ── 2. Delete Msafiri entitlement ─────────────────────────────────────
  console.log(`Deleting Msafiri entitlement (${MSAFIRI_ENTITLEMENT_ID}) ...`);
  const { error: entErr } = await deleteEntitlement({
    client,
    path: { project_id: WORRUSH_PROJECT_ID, entitlement_id: MSAFIRI_ENTITLEMENT_ID },
  });
  if (entErr) console.warn("  Could not delete entitlement:", JSON.stringify(entErr));
  else console.log("  ✓ Entitlement deleted");

  // ── 3. Delete Msafiri products (those belonging to Msafiri apps) ───────
  console.log("\nDeleting Msafiri products ...");
  const msafiriAppIds = new Set(MSAFIRI_APPS_TO_DELETE.map((a) => a.id));
  const msafiriOrSafedriveProducts = (products?.items ?? []).filter(
    (p) => msafiriAppIds.has(p.app_id) || p.store_identifier.includes("safedrive") || p.store_identifier.includes("msafiri")
  );

  for (const p of msafiriOrSafedriveProducts) {
    const { error } = await deleteProduct({ client, path: { project_id: WORRUSH_PROJECT_ID, product_id: p.id } });
    if (error) {
      // Product might have transaction history — detach from offering and leave orphaned
      console.warn(`  ⚠ Could not delete ${p.store_identifier} (${p.id}) — likely has transactions:`, (error as any).message ?? JSON.stringify(error));
    } else {
      console.log(`  ✓ Deleted product: ${p.store_identifier} (${p.id})`);
    }
  }

  // ── 4. Delete Msafiri apps ─────────────────────────────────────────────
  console.log("\nDeleting Msafiri apps ...");
  for (const app of MSAFIRI_APPS_TO_DELETE) {
    const { error } = await deleteApp({ client, path: { project_id: WORRUSH_PROJECT_ID, app_id: app.id } });
    if (error) console.error(`  ✗ Could not delete ${app.name}:`, JSON.stringify(error));
    else console.log(`  ✓ Deleted app: ${app.name} (${app.id})`);
  }

  console.log("\n✅ Cleanup complete.");
}

main().catch(console.error);
