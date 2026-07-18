import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProjects, listApps } from "@replit/revenuecat-sdk";

async function run() {
  const client = await getUncachableRevenueCatClient();
  const { data, error } = await listProjects({ client, query: { limit: 20 } });
  if (error) { console.error("listProjects error:", JSON.stringify(error)); return; }
  console.log(`Found ${data.items?.length ?? 0} project(s):`);
  for (const p of data.items ?? []) {
    console.log(`  [${p.id}] "${p.name}"`);
    const { data: apps } = await listApps({ client, path: { project_id: p.id }, query: { limit: 20 } });
    for (const a of apps?.items ?? []) {
      console.log(`    app [${a.id}] type=${a.type} name="${a.name}"`);
    }
  }
}

run().catch(console.error);
