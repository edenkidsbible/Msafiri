import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listOfferings,
  listPackages,
  getProductsFromPackage,
  getProductsFromEntitlement,
  listEntitlements,
} from "@replit/revenuecat-sdk";

const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID!;

const APP_LABELS: Record<string, string> = {
  app04cc3ac658: "iOS",
  appd3493629e8: "Android",
  appda86a73f1a: "Test Store",
};

async function run() {
  const client = await getUncachableRevenueCatClient();

  const { data: offerings } = await listOfferings({ client, path: { project_id: PROJECT_ID }, query: { limit: 20 } });
  const current = offerings?.items.find((o) => o.is_current);
  if (!current) { console.error("No current offering"); return; }
  console.log(`\nOffering: ${current.lookup_key} (${current.id})`);

  // Fetch packages separately
  const { data: pkgsData } = await listPackages({
    client,
    path: { project_id: PROJECT_ID, offering_id: current.id },
    query: { limit: 20 },
  });

  for (const pkg of pkgsData?.items ?? []) {
    console.log(`\n  Package: ${pkg.lookup_key} (${pkg.id})`);
    const { data: prods, error } = await getProductsFromPackage({
      client,
      path: { project_id: PROJECT_ID, offering_id: current.id, package_id: pkg.id },
      query: { limit: 20 },
    });
    if (error) { console.log("    ERROR:", JSON.stringify(error)); continue; }
    if (!prods?.items.length) { console.log("    ⚠️  (no products attached)"); continue; }
    for (const item of prods.items) {
      const p = (item as any).product;
      const label = APP_LABELS[p?.app_id] ?? p?.app_id ?? "unknown";
      console.log(`    ✓ [${label}] ${p?.store_identifier ?? "?"} (${p?.id ?? "?"})`);
    }
  }

  // Entitlement check
  const { data: entitlements } = await listEntitlements({ client, path: { project_id: PROJECT_ID }, query: { limit: 20 } });
  const proEnt = entitlements?.items.find((e) => e.lookup_key === "pro");
  if (proEnt) {
    const { data: entProds } = await getProductsFromEntitlement({
      client,
      path: { project_id: PROJECT_ID, entitlement_id: proEnt.id },
      query: { limit: 20 },
    });
    console.log(`\n  Entitlement 'pro' (${proEnt.id}):`);
    for (const p of entProds?.items ?? []) {
      const label = APP_LABELS[(p as any).app_id] ?? (p as any).app_id ?? "unknown";
      console.log(`    ✓ [${label}] ${(p as any).store_identifier ?? "?"} (${p.id})`);
    }
  }
}

run().catch(console.error);
