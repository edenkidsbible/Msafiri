import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProducts, getProduct } from "@replit/revenuecat-sdk";

async function checkIosPrices() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;
  const appleAppId = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;
  const testStoreAppId = process.env.REVENUECAT_TEST_STORE_APP_ID;

  console.log(`Project ID:       ${projectId}`);
  console.log(`Apple App ID:     ${appleAppId}`);
  console.log(`Test Store App ID:${testStoreAppId}\n`);

  const { data: products, error } = await listProducts({
    client,
    path: { project_id: projectId },
    query: { limit: 50 },
  });

  if (error) {
    console.error("Failed to list products:", JSON.stringify(error, null, 2));
    return;
  }

  // Focus on iOS and Test Store products with our identifiers
  const relevant = products.items.filter(
    (p: any) =>
      (p.app_id === appleAppId || p.app_id === testStoreAppId) &&
      (p.store_identifier === "msafiri_weekly" || p.store_identifier === "msafiri_monthly")
  );

  console.log(`Relevant products (${relevant.length}):\n`);
  for (const p of relevant) {
    const label = p.app_id === appleAppId ? "iOS (App Store)" : p.app_id === testStoreAppId ? "Test Store" : "Other";
    console.log(`[${label}]`);
    console.log(`  store_identifier : ${p.store_identifier}`);
    console.log(`  display_name     : ${p.display_name}`);
    console.log(`  id               : ${p.id}`);
    console.log(`  app_id           : ${p.app_id}`);

    // Fetch full product detail to get prices
    const { data: detail, error: detailErr } = await getProduct({
      client,
      path: { project_id: projectId, product_id: p.id },
    });
    if (detailErr) {
      console.log(`  prices           : ERROR - ${JSON.stringify(detailErr)}`);
    } else {
      console.log(`  prices           : ${JSON.stringify((detail as any).prices ?? (detail as any).price ?? "none")}`);
      console.log(`  full detail      : ${JSON.stringify(detail, null, 2)}`);
    }
    console.log();
  }
}

checkIosPrices().catch(console.error);
