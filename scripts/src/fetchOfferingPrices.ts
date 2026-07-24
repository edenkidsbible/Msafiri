import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { listOfferings, listPackages, getProductsFromPackage } from "@replit/revenuecat-sdk";

async function fetchOfferingPrices() {
  const client = await getUncachableRevenueCatClient();
  const projectId = process.env.REVENUECAT_PROJECT_ID!;

  const appLabels: Record<string, string> = {
    [process.env.REVENUECAT_APPLE_APP_STORE_APP_ID!]: "iOS App Store",
    [process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID!]: "Android",
    [process.env.REVENUECAT_TEST_STORE_APP_ID!]: "Test Store",
  };

  const { data: offerings, error } = await listOfferings({
    client,
    path: { project_id: projectId },
  });
  if (error) { console.error(error); return; }

  for (const offering of (offerings as any).items) {
    console.log(`\n══ Offering: "${offering.display_name}" (${offering.lookup_key}) — current: ${offering.is_current ?? false}\n`);

    const { data: packages } = await listPackages({
      client,
      path: { project_id: projectId, offering_id: offering.id },
    });

    for (const pkg of (packages as any)?.items ?? []) {
      console.log(`  📦 Package: "${pkg.display_name}" (${pkg.lookup_key})`);

      const { data: result } = await getProductsFromPackage({
        client,
        path: { project_id: projectId, offering_id: offering.id, package_id: pkg.id },
      });

      for (const entry of (result as any)?.items ?? []) {
        const prod = entry.product;
        const storeLabel = appLabels[prod.app_id] ?? prod.app_id;

        // Fetch test store prices for this product
        const { data: prices } = await (client as any).get({
          url: "/projects/{project_id}/products/{product_id}/test_store_prices",
          path: { project_id: projectId, product_id: prod.id },
        });

        const priceList = Array.isArray(prices) && prices.length > 0
          ? prices.map((p: any) => `${(p.amount / 100).toFixed(2)} ${p.currency}`).join(" | ")
          : "— (reads live from StoreKit/Play in-app)";

        console.log(`    [${storeLabel}]  "${prod.store_identifier}"  →  ${priceList}`);
      }
      console.log();
    }
  }
}

fetchOfferingPrices().catch(console.error);
