import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { getApp } from "@replit/revenuecat-sdk";

async function checkIosAppConfig() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;
  const appleAppId = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;

  const { data: app, error } = await getApp({
    client,
    path: { project_id: projectId, app_id: appleAppId },
  });

  if (error) { console.error(error); return; }

  console.log("iOS App full config:\n");
  console.log(JSON.stringify(app, null, 2));
}

checkIosAppConfig().catch(console.error);
