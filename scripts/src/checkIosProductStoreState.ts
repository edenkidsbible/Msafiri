import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { getProductStoreState } from "@replit/revenuecat-sdk";

const IOS_PRODUCTS = [
  { id: "prod8762a6436d", name: "msafiri_weekly" },
  { id: "prodb7e6217e8f", name: "msafiri_monthly" },
];

async function checkIosProductStoreState() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;

  for (const prod of IOS_PRODUCTS) {
    console.log(`\n── ${prod.name} (${prod.id})`);
    const { data, error } = await getProductStoreState({
      client,
      path: { project_id: projectId, product_id: prod.id },
    });
    if (error) {
      console.log(`  store state: ERROR — ${JSON.stringify(error)}`);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

checkIosProductStoreState().catch(console.error);
