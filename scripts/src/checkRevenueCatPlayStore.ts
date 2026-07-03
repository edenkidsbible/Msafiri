import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listApps, listProducts, listOfferings, listPackages, getProductsFromPackage } from "@replit/revenuecat-sdk";

async function main() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;

  const { data: apps, error: appsErr } = await listApps({ client, path: { project_id: projectId }, query: { limit: 20 } });
  if (appsErr) throw new Error("listApps failed: " + JSON.stringify(appsErr));
  console.log("Apps:");
  for (const a of apps.items ?? []) {
    console.log(`  - ${a.name} (${a.type}) id=${a.id}`, (a as any).play_store ?? (a as any).app_store ?? "");
  }

  const playStoreApp = apps.items?.find((a) => a.type === "play_store");
  if (!playStoreApp) {
    console.log("No Play Store app found!");
    return;
  }

  const { data: products, error: prodErr } = await listProducts({ client, path: { project_id: projectId }, query: { limit: 100 } });
  if (prodErr) throw new Error("listProducts failed: " + JSON.stringify(prodErr));
  const playStoreProducts = (products.items ?? []).filter((p) => p.app_id === playStoreApp.id);
  console.log(`\nPlay Store products (app_id=${playStoreApp.id}):`);
  for (const p of playStoreProducts) {
    console.log(`  - ${p.display_name} store_identifier=${p.store_identifier} id=${p.id}`);
  }
  if (playStoreProducts.length === 0) console.log("  (none)");

  const { data: offerings, error: offErr } = await listOfferings({ client, path: { project_id: projectId }, query: { limit: 20 } });
  if (offErr) throw new Error("listOfferings failed: " + JSON.stringify(offErr));
  console.log("\nOfferings:");
  for (const o of offerings.items ?? []) {
    console.log(`  - ${o.display_name} lookup_key=${o.lookup_key} is_current=${o.is_current} id=${o.id}`);

    const { data: pkgs, error: pkgErr } = await listPackages({ client, path: { project_id: projectId, offering_id: o.id }, query: { limit: 20 } });
    if (pkgErr) { console.log("    (failed to list packages)", JSON.stringify(pkgErr)); continue; }
    for (const pkg of pkgs.items ?? []) {
      console.log(`    Package: ${pkg.display_name} lookup_key=${pkg.lookup_key} id=${pkg.id}`);
      const { data: pkgProducts, error: pkgProdErr } = await getProductsFromPackage({ client, path: { project_id: projectId, package_id: pkg.id } });
      if (pkgProdErr) { console.log("      (failed to list products in package)"); continue; }
      for (const item of pkgProducts?.items ?? []) {
        console.log(`      - product ${item.product.display_name} app_id=${item.product.app_id} store_identifier=${item.product.store_identifier}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
