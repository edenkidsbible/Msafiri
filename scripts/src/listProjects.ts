import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProjects, listApps, listAppPublicApiKeys } from "@replit/revenuecat-sdk";

async function main() {
  const client = await getUncachableRevenueCatClient();

  const { data: projects, error } = await listProjects({ client });
  if (error) { console.error("Error:", JSON.stringify(error)); return; }

  console.log(`Found ${projects.items.length} project(s):\n`);

  for (const project of projects.items) {
    console.log(`PROJECT: "${project.name}" id=${project.id}`);

    const { data: apps } = await listApps({
      client,
      path: { project_id: project.id },
    });

    if (apps?.items) {
      for (const app of apps.items) {
        console.log(`  APP: "${app.name}" id=${app.id} type=${app.type}`);

        const { data: keys } = await listAppPublicApiKeys({
          client,
          path: { project_id: project.id, app_id: app.id },
        });
        if (keys?.items?.length) {
          for (const key of keys.items) {
            // key object shape varies — print everything
            const keyStr = JSON.stringify(key);
            console.log(`    KEY: ${keyStr}`);
          }
        }
      }
    }
    console.log();
  }
}

main().catch(console.error);
