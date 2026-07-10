import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { getApp, getAppStorekitConfig } from "@replit/revenuecat-sdk";

const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID!;
const IOS_APP_ID = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;

async function main() {
  const client = await getUncachableRevenueCatClient();

  const { data: app, error: appErr } = await getApp({
    client,
    path: { project_id: PROJECT_ID, app_id: IOS_APP_ID },
  });
  if (appErr) { console.error("getApp error:", JSON.stringify(appErr)); return; }
  console.log("=== iOS App ===");
  console.log(JSON.stringify(app, null, 2));

  const { data: skConfig, error: skErr } = await getAppStorekitConfig({
    client,
    path: { project_id: PROJECT_ID, app_id: IOS_APP_ID },
  });
  if (skErr) { console.log("StoreKit config error:", JSON.stringify(skErr)); return; }
  console.log("\n=== StoreKit Config ===");
  console.log(JSON.stringify(skConfig, null, 2));
}

main().catch(console.error);
