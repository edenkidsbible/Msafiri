import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProducts } from "@replit/revenuecat-sdk";

async function checkTestStorePrices() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;
  const testStoreAppId = process.env.REVENUECAT_TEST_STORE_APP_ID!;
  const appleAppId = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!;

  const { data: products, error } = await listProducts({
    client,
    path: { project_id: projectId },
    query: { limit: 50 },
  });

  if (error) { console.error(error); return; }

  // Check test store AND iOS app store products
  const targets = products.items.filter(
    (p: any) =>
      (p.app_id === testStoreAppId || p.app_id === appleAppId) &&
      (p.store_identifier === "msafiri_weekly" || p.store_identifier === "msafiri_monthly")
  );

  for (const p of targets) {
    const storeLabel = p.app_id === appleAppId ? "iOS App Store" : "Test Store";
    console.log(`\n[${storeLabel}] ${p.display_name} (${p.store_identifier})`);
    console.log(`  product_id: ${p.id}`);

    // Fetch test store prices via undocumented endpoint
    const { data: prices, error: priceErr } = await (client as any).get({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: projectId, product_id: p.id },
    });

    if (priceErr) {
      console.log(`  test_store_prices: ERROR — ${JSON.stringify(priceErr)}`);
    } else {
      if (!prices || (Array.isArray(prices) && prices.length === 0)) {
        console.log(`  test_store_prices: (none configured)`);
      } else {
        console.log(`  test_store_prices: ${JSON.stringify(prices, null, 2)}`);
      }
    }
  }
}

checkTestStorePrices().catch(console.error);
