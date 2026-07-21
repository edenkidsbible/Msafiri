import { getUncachableRevenueCatClient } from "./revenueCatClient";
import {
  listOfferings,
  getProductsFromPackage,
  attachProductsToPackage,
  listEntitlements,
  getProductsFromEntitlement,
  attachProductsToEntitlement,
} from "@replit/revenuecat-sdk";

const PROJECT_ID = process.env.REVENUECAT_PROJECT_ID!;
const ANDROID_MONTHLY_PRODUCT_ID = "prod6f151ef4ac"; // msafiri_monthly_access:monthly
const MONTHLY_PACKAGE_LOOKUP = "$rc_monthly";

async function run() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. Resolve the current offering + $rc_monthly package IDs ────────────
  const { data: offerings, error: offErr } = await listOfferings({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 20 },
  });
  if (offErr) { console.error("Failed to list offerings:", offErr); return; }

  const currentOffering = offerings?.items.find((o) => o.is_current);
  if (!currentOffering) { console.error("No current offering found"); return; }
  console.log(`Current offering: ${currentOffering.lookup_key} (${currentOffering.id})`);

  // packages are inline on the offering
  const monthlyPkg = (currentOffering as any).packages?.find(
    (p: any) => p.lookup_key === MONTHLY_PACKAGE_LOOKUP
  );
  // If not inline, fall back to the known package ID from checkOfferings
  const monthlyPkgId = monthlyPkg?.id ?? "pkge5ba8be30ae";
  const offeringId = currentOffering.id;
  console.log(`$rc_monthly package id: ${monthlyPkgId}`);

  // ── 2. Check current package products ────────────────────────────────────
  const { data: pkgProds, error: pkgErr } = await getProductsFromPackage({
    client,
    path: { project_id: PROJECT_ID, offering_id: offeringId, package_id: monthlyPkgId },
    query: { limit: 20 },
  });
  if (pkgErr) { console.error("Failed to get package products:", pkgErr); return; }

  const attachedProductIds: string[] = pkgProds?.items.map((item: any) => item.product?.id).filter(Boolean) ?? [];
  console.log("Products currently in $rc_monthly:", attachedProductIds);

  // ── 3. Attach Android monthly to package if missing ──────────────────────
  if (attachedProductIds.includes(ANDROID_MONTHLY_PRODUCT_ID)) {
    console.log("✓ Android monthly already in $rc_monthly package.");
  } else {
    console.log("Attaching Android monthly to $rc_monthly package...");
    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: PROJECT_ID, package_id: monthlyPkgId },
      body: {
        products: [{ product_id: ANDROID_MONTHLY_PRODUCT_ID, eligibility_criteria: "all" as const }],
      },
    });
    if (attachPkgErr) { console.error("Failed to attach to package:", JSON.stringify(attachPkgErr)); return; }
    console.log("✓ Attached Android monthly to $rc_monthly package.");
  }

  // ── 4. Find 'pro' entitlement ────────────────────────────────────────────
  const { data: entitlements, error: entErr } = await listEntitlements({
    client,
    path: { project_id: PROJECT_ID },
    query: { limit: 20 },
  });
  if (entErr) { console.error("Failed to list entitlements:", entErr); return; }

  const proEnt = entitlements?.items.find((e) => e.lookup_key === "pro");
  if (!proEnt) { console.error("'pro' entitlement not found"); return; }
  console.log(`\n'pro' entitlement: ${proEnt.id}`);

  // ── 5. Check entitlement products ────────────────────────────────────────
  const { data: entProds, error: entProdErr } = await getProductsFromEntitlement({
    client,
    path: { project_id: PROJECT_ID, entitlement_id: proEnt.id },
    query: { limit: 20 },
  });
  if (entProdErr) { console.error("Failed to get entitlement products:", entProdErr); return; }

  const entProductIds: string[] = entProds?.items.map((p: any) => p.id).filter(Boolean) ?? [];
  console.log("Products in 'pro' entitlement:", entProductIds);

  // ── 6. Attach to entitlement if missing ──────────────────────────────────
  if (entProductIds.includes(ANDROID_MONTHLY_PRODUCT_ID)) {
    console.log("✓ Android monthly already in 'pro' entitlement.");
  } else {
    console.log("Attaching Android monthly to 'pro' entitlement...");
    const { error: attachEntErr } = await attachProductsToEntitlement({
      client,
      path: { project_id: PROJECT_ID, entitlement_id: proEnt.id },
      body: { product_ids: [ANDROID_MONTHLY_PRODUCT_ID] },
    });
    if (attachEntErr) { console.error("Failed to attach to entitlement:", JSON.stringify(attachEntErr)); return; }
    console.log("✓ Attached Android monthly to 'pro' entitlement.");
  }

  console.log("\n✅ Done. Android msafiri_monthly_access is now wired to the $rc_monthly package and 'pro' entitlement.");
}

run().catch(console.error);
