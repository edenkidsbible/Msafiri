import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProducts } from "@replit/revenuecat-sdk";

async function checkIosProductIds() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;
  const appleAppId = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID;

  const { data: products, error } = await listProducts({
    client,
    path: { project_id: projectId },
    query: { limit: 50 },
  });

  if (error) {
    console.error("Failed to list products:", JSON.stringify(error, null, 2));
    return;
  }

  const iosProducts = products.items.filter(
    (p: any) => p.app_id === appleAppId
  );

  console.log(`\nAPPLE_APP_STORE_APP_ID env: ${appleAppId}`);
  console.log(`\nAll products (${products.items.length} total):\n`);
  for (const p of products.items) {
    console.log(
      `  [${p.app_id === appleAppId ? "iOS" : p.app_id === process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID ? "Android" : "Other"}] id=${p.id}  store_identifier="${p.store_identifier}"  display_name="${p.display_name}"  app_id=${p.app_id}`
    );
  }

  console.log(`\niOS products only (${iosProducts.length}):\n`);
  for (const p of iosProducts) {
    console.log(
      `  store_identifier: "${p.store_identifier}"  display_name: "${p.display_name}"  id: ${p.id}`
    );
  }

  const hasWeekly = iosProducts.some(
    (p: any) => p.store_identifier === "msafiri_weekly"
  );
  const hasMonthly = iosProducts.some(
    (p: any) => p.store_identifier === "msafiri_monthly"
  );

  console.log(`\n--- Check ---`);
  console.log(`msafiri_weekly  present: ${hasWeekly}`);
  console.log(`msafiri_monthly present: ${hasMonthly}`);
}

checkIosProductIds().catch(console.error);
