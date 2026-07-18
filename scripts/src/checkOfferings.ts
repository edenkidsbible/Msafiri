import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listOfferings, listPackages, listProducts, listApps } from "@replit/revenuecat-sdk";

const PROJECT_ID = "projae197094";

async function run() {
  const client = await getUncachableRevenueCatClient();

  const { data: apps } = await listApps({ client, path: { project_id: PROJECT_ID }, query: { limit: 20 } });
  console.log("\nApps:");
  for (const a of apps?.items ?? []) {
    console.log(`  ${a.type.padEnd(12)} ${a.id}  "${a.name}"`);
  }

  const { data: offerings } = await listOfferings({ client, path: { project_id: PROJECT_ID }, query: { limit: 20 } });
  console.log("\nOfferings:");
  for (const o of offerings?.items ?? []) {
    console.log(`  ${o.lookup_key}  is_current=${o.is_current}`);

    const { data: pkgs } = await listPackages({
      client,
      path: { project_id: PROJECT_ID, offering_id: o.id },
      query: { limit: 20 },
    });
    for (const pkg of pkgs?.items ?? []) {
      console.log(`    pkg: ${pkg.lookup_key} (${pkg.id})`);
    }
  }

  const { data: products } = await listProducts({ client, path: { project_id: PROJECT_ID }, query: { limit: 100 } });
  console.log("\nProducts:");
  for (const p of products?.items ?? []) {
    console.log(`  [${p.app_id}] ${p.store_identifier}  type=${p.type}  id=${p.id}`);
  }
}

run().catch(console.error);
