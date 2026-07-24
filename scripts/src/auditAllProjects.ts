import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProjects, listApps, listAppPublicApiKeys } from "@replit/revenuecat-sdk";

async function auditAllProjects() {
  const client = await getUncachableRevenueCatClient();

  const { data: projects, error } = await listProjects({ client });
  if (error) { console.error(error); return; }

  console.log(`Found ${projects.items.length} project(s)\n`);

  for (const proj of projects.items as any[]) {
    console.log(`══════════════════════════════════════`);
    console.log(`Project: "${proj.name}"  id: ${proj.id}`);

    const { data: apps, error: appsErr } = await listApps({
      client,
      path: { project_id: proj.id },
    });
    if (appsErr) { console.log(`  apps: ERROR`); continue; }

    for (const app of (apps as any).items ?? []) {
      console.log(`\n  App: "${app.name}"  type: ${app.type}  id: ${app.id}`);
      if (app.bundle_id)  console.log(`    bundle_id:  ${app.bundle_id}`);
      if (app.package_name) console.log(`    package:    ${app.package_name}`);

      const { data: keys } = await listAppPublicApiKeys({
        client,
        path: { project_id: proj.id, app_id: app.id },
      });
      for (const k of (keys as any)?.items ?? []) {
        console.log(`    public key: ${k.key}`);
      }
    }
    console.log();
  }
}

auditAllProjects().catch(console.error);
