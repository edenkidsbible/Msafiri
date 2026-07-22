import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  deleteProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  detachProductsFromPackage,
  getProductsFromPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "Msafiri Kenya";

const APP_STORE_APP_NAME = "Msafiri Kenya iOS";
const APP_STORE_BUNDLE_ID = "com.msafirikenya.app";
const PLAY_STORE_APP_NAME = "Msafiri Kenya Android";
const PLAY_STORE_PACKAGE_NAME = "com.msafirikenya.app";

const ENTITLEMENT_IDENTIFIER = "pro";
const ENTITLEMENT_DISPLAY_NAME = "Msafiri Access";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Default Offering";

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

const PRODUCTS = [
  {
    identifier: "msafiri_weekly",
    playStoreIdentifier: "msafiri_weekly:weekly",
    displayName: "Msafiri Weekly",
    title: "Msafiri Weekly",
    duration: "P1W" as const,
    packageIdentifier: "$rc_weekly",
    packageDisplayName: "Weekly Subscription",
    prices: [
      { amount_micros: 100_000_000, currency: "KES" },
    ],
  },
  {
    identifier: "msafiri_monthly",
    playStoreIdentifier: "msafiri_monthly_access:monthly",
    displayName: "Msafiri Monthly",
    title: "Msafiri Monthly",
    duration: "P1M" as const,
    packageIdentifier: "$rc_monthly",
    packageDisplayName: "Monthly Subscription",
    prices: [
      { amount_micros: 300_000_000, currency: "KES" },
    ],
  },
];

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // The OAuth token may have access to multiple projects (e.g. shared Replit demo account).
  // Prefer the project pinned via REVENUECAT_PROJECT_ID (set once this app's project is
  // provisioned); only fall back to name-matching or "first project" if that's unset,
  // since blindly picking items[0] can silently target an unrelated project.
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });

  if (listProjectsError) throw new Error("Failed to list projects");

  const pinnedProjectId = process.env.REVENUECAT_PROJECT_ID;
  let project: Project | undefined;
  if (pinnedProjectId) {
    project = existingProjects.items?.find((p) => p.id === pinnedProjectId);
    if (!project) {
      throw new Error(
        `REVENUECAT_PROJECT_ID=${pinnedProjectId} is set but no matching project was found for this account. Refusing to guess a different project.`
      );
    }
  } else {
    project = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
    if (!project && (existingProjects.items?.length ?? 0) > 1) {
      throw new Error(
        `Multiple RevenueCat projects are visible to this account (${existingProjects.items!.map((p) => p.name).join(", ")}) and none is named "${PROJECT_NAME}". Set REVENUECAT_PROJECT_ID to the correct project id before seeding.`
      );
    }
    project = project ?? existingProjects.items?.[0];
  }
  if (!project) throw new Error("No RevenueCat projects found for this account");
  console.log("Using project:", project.name, "(id:", project.id + ")");

  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listAppsError || !apps || apps.items.length === 0) {
    throw new Error("No apps found");
  }

  // This RevenueCat project is shared with other apps (e.g. a different game on this
  // account), which each have their own app_store/play_store app entries. Blindly
  // picking the first app of a given `type` previously caused this script to target
  // the WRONG app's bundle id/package name. Always prefer matching by the pinned
  // REVENUECAT_*_APP_ID env vars (or by bundle id/package name) over "first of type".
  const pinnedAppStoreAppId = process.env.REVENUECAT_APPLE_APP_STORE_APP_ID;
  const pinnedPlayStoreAppId = process.env.REVENUECAT_GOOGLE_PLAY_STORE_APP_ID;

  let testApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = pinnedAppStoreAppId
    ? apps.items.find((a) => a.id === pinnedAppStoreAppId)
    : apps.items.find((a) => a.type === "app_store" && (a as any).app_store?.bundle_id === APP_STORE_BUNDLE_ID);
  let playStoreApp: App | undefined = pinnedPlayStoreAppId
    ? apps.items.find((a) => a.id === pinnedPlayStoreAppId)
    : apps.items.find((a) => a.type === "play_store" && (a as any).play_store?.package_name === PLAY_STORE_PACKAGE_NAME);

  if (pinnedAppStoreAppId && !appStoreApp) {
    throw new Error(
      `REVENUECAT_APPLE_APP_STORE_APP_ID=${pinnedAppStoreAppId} is set but no matching app was found. Refusing to guess a different app store app.`,
    );
  }
  if (pinnedPlayStoreAppId && !playStoreApp) {
    throw new Error(
      `REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=${pinnedPlayStoreAppId} is set but no matching app was found. Refusing to guess a different play store app.`,
    );
  }

  if (!testApp) throw new Error("No test store app found");
  console.log("Test store app found:", testApp.id);

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: APP_STORE_APP_NAME,
        type: "app_store",
        app_store: { bundle_id: APP_STORE_BUNDLE_ID },
      },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: PLAY_STORE_APP_NAME,
        type: "play_store",
        play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
      },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });

  if (listProductsError) throw new Error("Failed to list products");

  const ensureProduct = async (
    targetApp: App,
    label: string,
    productIdentifier: string,
    isTestStore: boolean,
    duration: "P1W" | "P1M" | "P2M" | "P3M" | "P6M" | "P1Y",
    displayName: string,
    title: string,
  ): Promise<Product> => {
    const existing = existingProducts.items?.find(
      (p) => p.store_identifier === productIdentifier && p.app_id === targetApp.id,
    );
    if (existing) {
      console.log(`${label} product already exists:`, existing.id);
      return existing;
    }

    const body: CreateProductData["body"] = {
      store_identifier: productIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: displayName,
    };

    if (isTestStore) {
      body.subscription = { duration };
      body.title = title;
    }

    const { data: created, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });

    if (error) throw new Error(`Failed to create ${label} product: ${JSON.stringify(error)}`);
    console.log(`Created ${label} product:`, created.id);
    return created;
  };

  type TestStorePrice = { amount: number; amount_micros: number; currency: string };

  const getTestStorePrices = async (productId: string): Promise<TestStorePrice[]> => {
    const { data, error } = await client.get<TestStorePrice[]>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: productId },
    });
    if (error) throw new Error(`Failed to list test store prices: ${JSON.stringify(error)}`);
    return data ?? [];
  };

  const addTestStorePrices = async (
    productId: string,
    prices: { amount_micros: number; currency: string }[],
  ) => {
    const { error } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: productId },
      body: { prices },
    });
    if (error) throw new Error(`Failed to add test store prices: ${JSON.stringify(error)}`);
  };

  /**
   * RevenueCat's test_store_prices endpoint only supports POST (add) and GET (list) -
   * there is no PATCH/PUT/DELETE to change an existing currency's amount. If a price
   * for the currency already exists with a different amount, we must replace the
   * underlying test-store product: detach it from its package, delete it (or, if it
   * has transaction history and can't be deleted, leave it orphaned and mint a new
   * product under a versioned identifier), then attach the replacement in its place.
   * This avoids ever silently leaving a stale price live, which happened previously.
   */
  const ensureTestStorePrice = async (
    testProduct: Product,
    prod: (typeof PRODUCTS)[number],
    packageId: string,
  ): Promise<Product> => {
    const desired = prod.prices[0];

    // Deterministic fallback identifier used when the original test-store product
    // can't be deleted (has transaction history). Stable across runs so we reuse
    // the same replacement instead of minting a new one every time.
    const fallbackIdentifier = `${prod.identifier}_fixed`;
    const fallbackExisting = existingProducts.items?.find(
      (p) => p.store_identifier === fallbackIdentifier && p.app_id === testProduct.app_id,
    );

    const activeProduct = fallbackExisting ?? testProduct;
    const existingPrices = await getTestStorePrices(activeProduct.id);
    const matching = existingPrices.find((p) => p.currency === desired.currency);

    if (!matching) {
      console.log("Adding test store prices:", JSON.stringify(prod.prices));
      await addTestStorePrices(activeProduct.id, prod.prices);
      console.log("Added test store prices");
      return activeProduct;
    }

    if (matching.amount_micros === desired.amount_micros) {
      console.log(
        `Test store price already correct for ${prod.identifier}: ${matching.amount_micros} ${matching.currency}`,
      );
      return activeProduct;
    }

    console.log(
      `Test store price for ${prod.identifier} is stale (${matching.amount_micros} ${matching.currency} != desired ${desired.amount_micros}). Replacing product.`,
    );

    const { data: attachedProducts, error: listAttachedError } = await getProductsFromPackage({
      client,
      path: { project_id: project.id, package_id: packageId },
    });
    if (listAttachedError) {
      throw new Error(`Failed to list products attached to package: ${JSON.stringify(listAttachedError)}`);
    }
    const staleAttachedIds = (attachedProducts?.items ?? [])
      .filter((item) => item.product.app_id === testProduct.app_id)
      .map((item) => item.product.id);

    if (staleAttachedIds.length > 0) {
      const { error: detachError } = await detachProductsFromPackage({
        client,
        path: { project_id: project.id, package_id: packageId },
        body: { product_ids: staleAttachedIds },
      });
      if (
        detachError &&
        !(typeof detachError === "object" && "message" in detachError && String((detachError as any).message).includes("not currently attached"))
      ) {
        throw new Error(`Failed to detach stale test store product: ${JSON.stringify(detachError)}`);
      }
      console.log(`Detached stale test store product(s) from package: ${staleAttachedIds.join(", ")}`);
    }

    const { error: deleteError } = await deleteProduct({
      client,
      path: { project_id: project.id, product_id: activeProduct.id },
    });

    let newIdentifier = prod.identifier;
    let newDisplayName = prod.displayName;
    let newTitle = prod.title;
    if (deleteError) {
      console.log(
        `Could not delete stale test store product ${activeProduct.id} (likely has transaction history): ${JSON.stringify(deleteError)}. Creating a stable replacement under "${fallbackIdentifier}" instead.`,
      );
      newIdentifier = fallbackIdentifier;
      newDisplayName = `${prod.displayName} (fixed price)`;
      newTitle = `${prod.title} (fixed price)`;
    }

    const { data: replacement, error: createError } = await createProduct({
      client,
      path: { project_id: project.id },
      body: {
        store_identifier: newIdentifier,
        app_id: testProduct.app_id,
        type: "subscription",
        display_name: newDisplayName,
        title: newTitle,
        subscription: { duration: prod.duration },
      },
    });
    if (createError || !replacement) {
      throw new Error(`Failed to create replacement test store product: ${JSON.stringify(createError)}`);
    }
    console.log(`Created replacement test store product: ${replacement.id} (${newIdentifier})`);

    await addTestStorePrices(replacement.id, prod.prices);
    console.log("Added correct test store prices to replacement product");

    const { error: attachError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: packageId },
      body: { products: [{ product_id: replacement.id, eligibility_criteria: "all" }] },
    });
    if (attachError) {
      throw new Error(`Failed to attach replacement test store product: ${JSON.stringify(attachError)}`);
    }
    console.log(`Attached replacement product to package ${packageId}`);

    return replacement;
  };

  let entitlement: Entitlement | undefined;
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const existingEntitlement = existingEntitlements.items?.find(
    (e) => e.lookup_key === ENTITLEMENT_IDENTIFIER,
  );

  if (existingEntitlement) {
    console.log("Entitlement already exists:", existingEntitlement.id);
    entitlement = existingEntitlement;
  } else {
    const { data: newEntitlement, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: { lookup_key: ENTITLEMENT_IDENTIFIER, display_name: ENTITLEMENT_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create entitlement");
    console.log("Created entitlement:", newEntitlement.id);
    entitlement = newEntitlement;
  }

  let offering: Offering | undefined;
  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listOfferingsError) throw new Error("Failed to list offerings");

  const existingOffering = existingOfferings.items?.find(
    (o) => o.lookup_key === OFFERING_IDENTIFIER,
  );

  if (existingOffering) {
    console.log("Offering already exists:", existingOffering.id);
    offering = existingOffering;
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: { lookup_key: OFFERING_IDENTIFIER, display_name: OFFERING_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }

  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current");
  }

  const allProductIds: string[] = [];

  for (const prod of PRODUCTS) {
    console.log(`\n── Setting up product: ${prod.displayName} ──`);

    const testProduct = await ensureProduct(
      testApp,
      `Test Store (${prod.identifier})`,
      prod.identifier,
      true,
      prod.duration,
      prod.displayName,
      prod.title,
    );

    const iosProduct = await ensureProduct(
      appStoreApp,
      `App Store (${prod.identifier})`,
      prod.identifier,
      false,
      prod.duration,
      prod.displayName,
      prod.title,
    );

    const androidProduct = await ensureProduct(
      playStoreApp,
      `Play Store (${prod.playStoreIdentifier})`,
      prod.playStoreIdentifier,
      false,
      prod.duration,
      prod.displayName,
      prod.title,
    );

    const { data: existingPkgs, error: listPkgsError } = await listPackages({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      query: { limit: 20 },
    });

    if (listPkgsError) throw new Error("Failed to list packages");

    let pkg: Package | undefined = existingPkgs.items?.find(
      (p) => p.lookup_key === prod.packageIdentifier,
    );

    if (pkg) {
      console.log("Package already exists:", pkg.id);
    } else {
      const { data: newPkg, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: { lookup_key: prod.packageIdentifier, display_name: prod.packageDisplayName },
      });
      if (error) throw new Error("Failed to create package: " + JSON.stringify(error));
      console.log("Created package:", newPkg.id);
      pkg = newPkg;
    }

    const syncedTestProduct = await ensureTestStorePrice(testProduct, prod, pkg.id);

    allProductIds.push(syncedTestProduct.id, iosProduct.id, androidProduct.id);

    // Fetch which products are already in the package so we only send the missing
    // ones. The RevenueCat v2 API rejects the ENTIRE batch if any product in it is
    // already attached, so a single-call approach silently drops products when the
    // package is partially populated across seed re-runs.
    const { data: alreadyAttached } = await getProductsFromPackage({
      client,
      path: { project_id: project.id, offering_id: offering.id, package_id: pkg.id },
      query: { limit: 20 },
    });
    const attachedIds = new Set((alreadyAttached?.items ?? []).map((item: any) => item.product?.id).filter(Boolean));

    const toAttach = [syncedTestProduct.id, iosProduct.id, androidProduct.id].filter(
      (id) => !attachedIds.has(id),
    );

    if (toAttach.length === 0) {
      console.log("All products already attached to package — skipping");
    } else {
      const { error: attachPkgError } = await attachProductsToPackage({
        client,
        path: { project_id: project.id, package_id: pkg.id },
        body: {
          products: toAttach.map((id) => ({ product_id: id, eligibility_criteria: "all" as const })),
        },
      });

      if (attachPkgError) {
        throw new Error("Failed to attach products to package: " + JSON.stringify(attachPkgError));
      }
      console.log(`Attached ${toAttach.length} product(s) to package`);
    }
  }

  const { error: attachEntError } = await attachProductsToEntitlement({
    client,
    path: { project_id: project.id, entitlement_id: entitlement.id },
    body: { product_ids: allProductIds },
  });

  if (attachEntError) {
    if ((attachEntError as any).type === "unprocessable_entity_error") {
      console.log("Products already attached to entitlement");
    } else {
      throw new Error("Failed to attach products to entitlement: " + JSON.stringify(attachEntError));
    }
  } else {
    console.log("Attached all products to entitlement");
  }

  const { data: testKeys } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: testApp.id },
  });
  const { data: iosKeys } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: appStoreApp.id },
  });
  const { data: androidKeys } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: playStoreApp.id },
  });

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Entitlement:", ENTITLEMENT_IDENTIFIER);
  console.log("Public API Keys - Test Store:", testKeys?.items.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Public API Keys - App Store:", iosKeys?.items.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Public API Keys - Play Store:", androidKeys?.items.map((k) => k.key).join(", ") ?? "N/A");
  console.log("====================\n");
  console.log("Store these in your environment variables:");
  console.log("REVENUECAT_PROJECT_ID=" + project.id);
  console.log("REVENUECAT_TEST_STORE_APP_ID=" + testApp.id);
  console.log("REVENUECAT_APPLE_APP_STORE_APP_ID=" + appStoreApp.id);
  console.log("REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=" + playStoreApp.id);
  console.log("EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=" + (testKeys?.items[0]?.key ?? "N/A"));
  console.log("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=" + (iosKeys?.items[0]?.key ?? "N/A"));
  console.log("EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=" + (androidKeys?.items[0]?.key ?? "N/A"));
}

seedRevenueCat().catch(console.error);
