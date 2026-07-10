import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listApps,
  listEntitlements,
  listOfferings,
  listPackages,
  listProducts,
  getProductsFromPackage,
} from "@replit/revenuecat-sdk";

const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID!;
const TEST_APP_ID = process.env.REVENUECAT_TEST_STORE_APP_ID!;
const IOS_APP_ID = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;
const ANDROID_APP_ID = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID!;

async function main() {
  const client = await getUncachableRevenueCatClient();

  // ── Entitlements ─────────────────────────────────────────────────────────
  const { data: entsData, error: entsErr } = await listEntitlements({
    client, path: { project_id: PROJECT_ID }, query: { limit: 20 },
  });
  if (entsErr) throw new Error("Failed to list entitlements: " + JSON.stringify(entsErr));
  console.log("\n=== ENTITLEMENTS ===");
  for (const e of entsData.items) {
    console.log(`  display_name="${e.display_name}" lookup_key="${e.lookup_key}" id="${e.id}"`);
  }

  // ── Products per store ───────────────────────────────────────────────────
  console.log("\n=== PRODUCTS (Msafiri apps only) ===");
  for (const [tag, appId] of [["TEST", TEST_APP_ID], ["IOS", IOS_APP_ID], ["ANDROID", ANDROID_APP_ID]]) {
    const { data: prodData, error: prodErr } = await listProducts({
      client, path: { project_id: PROJECT_ID }, query: { limit: 40, app_id: appId },
    });
    if (prodErr) { console.log(`  [${tag}] Error:`, JSON.stringify(prodErr)); continue; }
    for (const p of prodData.items) {
      if (!p.store_identifier?.includes("msafiri")) continue;
      console.log(`  [${tag}] id="${p.id}" display_name="${p.display_name}" store_identifier="${p.store_identifier}"`);
    }
  }

  // ── Default Offering packages — raw dump ──────────────────────────────
  const { data: offData, error: offErr } = await listOfferings({
    client, path: { project_id: PROJECT_ID }, query: { limit: 20 },
  });
  if (offErr) throw new Error("Failed to list offerings: " + JSON.stringify(offErr));
  const defaultOffering = offData.items.find((o) => o.lookup_key === "default");
  if (!defaultOffering) { console.log("No default offering found!"); return; }
  console.log(`\n=== DEFAULT OFFERING === id="${defaultOffering.id}" is_current=${defaultOffering.is_current}`);

  const { data: pkgData, error: pkgErr } = await listPackages({
    client, path: { project_id: PROJECT_ID, offering_id: defaultOffering.id }, query: { limit: 20 },
  });
  if (pkgErr) throw new Error("Failed to list packages: " + JSON.stringify(pkgErr));

  for (const pkg of pkgData.items) {
    console.log(`\n  Package: "${pkg.display_name}" (${pkg.lookup_key}) id="${pkg.id}"`);
    const { data: pkgProds, error: pkgProdsErr } = await getProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, offering_id: defaultOffering.id, package_id: pkg.id },
      query: { limit: 20 },
    });
    if (pkgProdsErr) { console.log("    Error:", JSON.stringify(pkgProdsErr)); continue; }
    console.log(`    Raw items (${pkgProds.items.length}):`);
    for (const item of pkgProds.items) {
      // Log raw keys to discover actual field names
      console.log("    ", JSON.stringify(item));
    }
  }
}

main().catch(console.error);
