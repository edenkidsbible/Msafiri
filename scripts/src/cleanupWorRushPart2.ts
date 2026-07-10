import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  archiveProduct,
  deleteOffering,
} from "@replit/revenuecat-sdk";

const WORRUSH_PROJECT_ID = "projc48983a9";

// Two SafeDrive products with transaction history — archive instead of delete
const PRODUCTS_TO_ARCHIVE = [
  { id: "prod324277c74f", name: "safedrive_monthly" },
  { id: "prod32d0a14200", name: "safedrive_weekly" },
];

// "Default Offering" I created for Msafiri subscriptions — WorRush only needs "Gem Packages"
const MSAFIRI_OFFERING_ID = "ofrng26e04ec93a";

async function main() {
  const client = await getUncachableRevenueCatClient();

  // ── Archive products that have transaction history ────────────────────
  console.log("Archiving leftover SafeDrive products (have transaction history) ...");
  for (const p of PRODUCTS_TO_ARCHIVE) {
    const { error } = await archiveProduct({
      client,
      path: { project_id: WORRUSH_PROJECT_ID, product_id: p.id },
    });
    if (error) console.error(`  ✗ Could not archive ${p.name}:`, JSON.stringify(error));
    else console.log(`  ✓ Archived: ${p.name} (${p.id})`);
  }

  // ── Delete the Default Offering (weekly/monthly — was for Msafiri) ────
  console.log("\nDeleting Default Offering (ofrng26e04ec93a) ...");
  const { error: offerErr } = await deleteOffering({
    client,
    path: { project_id: WORRUSH_PROJECT_ID, offering_id: MSAFIRI_OFFERING_ID },
  });
  if (offerErr) console.error("  ✗ Could not delete offering:", JSON.stringify(offerErr));
  else console.log("  ✓ Default Offering deleted");

  console.log("\n✅ WorRush project is clean. Only Gem Packages offering and gems_* products remain.");
}

main().catch(console.error);
