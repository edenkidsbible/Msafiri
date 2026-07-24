import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listApps, listAppPublicApiKeys } from "@replit/revenuecat-sdk";

async function listAppApiKeys() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;

  const { data: apps, error } = await listApps({
    client,
    path: { project_id: projectId },
  });

  if (error) { console.error(error); return; }

  for (const app of apps.items as any[]) {
    console.log(`\nApp: ${app.name} (${app.type})`);
    console.log(`  app_id: ${app.id}`);

    const { data: keys, error: keyErr } = await listAppPublicApiKeys({
      client,
      path: { project_id: projectId, app_id: app.id },
    });

    if (keyErr) {
      console.log(`  public keys: ERROR — ${JSON.stringify(keyErr)}`);
    } else {
      for (const k of (keys as any).items ?? []) {
        console.log(`  public key: ${k.key}  (name: ${k.name ?? "—"})`);
      }
    }
  }
}

listAppApiKeys().catch(console.error);
