import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listProducts } from "@replit/revenuecat-sdk";

// Calls the RevenueCat v1 customer-facing API (what the SDK actually calls)
// using both the Android production key and the test key, then compares
// what packages/products come back for each.

const ANDROID_API_KEY = "goog_ooNOODiUZCkYXUFSBbDimjbtSHL";
const TEST_API_KEY = "test_NpbxUUJoJudMdUxALbNRtPEVkjD";

const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID!;
const ANDROID_APP_ID = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID!;

async function fetchV1Offerings(apiKey: string, platform: string, label: string) {
  const url = `https://api.revenuecat.com/v1/subscribers/$RCAnonymousID:msafiri_compare/offerings`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Platform": platform,
      "X-Platform-Version": "34",
      "X-Version": "7.0.0",
      "Content-Type": "application/json",
    },
  });
  const json = await res.json() as any;

  console.log(`\n===== ${label} (HTTP ${res.status}) =====`);
  if (json.code && json.code !== 0) {
    console.log("  Error:", json.code, json.message);
    return;
  }
  console.log("  current_offering_id:", json.current_offering_id);
  for (const o of json.offerings ?? []) {
    console.log(`\n  Offering: ${o.identifier}`);
    for (const pkg of o.packages ?? []) {
      const prodId = pkg.platform_product_identifier ?? "(none)";
      const sp = pkg.store_product;
      if (!sp) {
        console.log(`    ${pkg.identifier.padEnd(14)}  product="${prodId}"  *** NO store_product ***`);
      } else {
        const price = sp.priceString ?? sp.price ?? "(no price)";
        const title = sp.title ?? sp.productIdentifier ?? "";
        console.log(`    ${pkg.identifier.padEnd(14)}  product="${prodId}"  price=${price}  title="${title}"`);
      }
    }
  }
}

async function checkAndroidProductDetails() {
  // Also dump the raw management-API product records for both Android products
  // so we can compare their metadata side-by-side.
  const client = await getUncachableRevenueCatClient();
  const { data, error } = await listProducts({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 40, app_id: ANDROID_APP_ID },
  });
  if (error) { console.log("Error listing products:", error); return; }

  console.log("\n===== Android product records (management API) =====");
  for (const p of data?.items ?? []) {
    if (!p.store_identifier?.includes("msafiri")) continue;
    console.log(`  ${p.store_identifier}`);
    console.log(`    id=${p.id}  state=${p.state}`);
    console.log(`    subscription=${JSON.stringify((p as any).subscription)}`);
    console.log(`    created_at=${new Date((p as any).created_at).toISOString()}`);
  }
}

async function run() {
  await Promise.all([
    fetchV1Offerings(ANDROID_API_KEY, "android", "ANDROID production key"),
    fetchV1Offerings(TEST_API_KEY, "ios", "TEST key (simulated)"),
  ]);
  await checkAndroidProductDetails();
}

run().catch(console.error);
