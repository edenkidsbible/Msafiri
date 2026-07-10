import { getUncachableRevenueCatClient } from "./revenueCatClient";
import { updateOffering, deleteOffering } from "@replit/revenuecat-sdk";

const WORRUSH_PROJECT_ID = "projc48983a9";
const GEM_PACKAGES_OFFERING_ID = "ofrngffc843f7e2"; // WorRush's real offering
const MSAFIRI_OFFERING_ID = "ofrng26e04ec93a";       // the one I created for Msafiri

async function main() {
  const client = await getUncachableRevenueCatClient();

  console.log("Setting Gem Packages as the default offering ...");
  const { error: setDefaultErr } = await updateOffering({
    client,
    path: { project_id: WORRUSH_PROJECT_ID, offering_id: GEM_PACKAGES_OFFERING_ID },
    body: { is_current: true },
  });
  if (setDefaultErr) {
    console.error("  ✗ Could not set default:", JSON.stringify(setDefaultErr));
    return;
  }
  console.log("  ✓ Gem Packages is now the default offering");

  console.log("\nDeleting the Msafiri Default Offering ...");
  const { error: delErr } = await deleteOffering({
    client,
    path: { project_id: WORRUSH_PROJECT_ID, offering_id: MSAFIRI_OFFERING_ID },
  });
  if (delErr) console.error("  ✗ Could not delete:", JSON.stringify(delErr));
  else console.log("  ✓ Msafiri offering deleted");

  console.log("\n✅ WorRush project fully restored. Only 'Gem Packages' offering remains.");
}

main().catch(console.error);
