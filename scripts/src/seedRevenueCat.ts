import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "SafeDrive Kenya";

const APP_STORE_APP_NAME = "SafeDrive Kenya iOS";
const APP_STORE_BUNDLE_ID = "com.safedrive.kenya";
const PLAY_STORE_APP_NAME = "SafeDrive Kenya Android";
const PLAY_STORE_PACKAGE_NAME = "com.safedrive.kenya";

const ENTITLEMENT_IDENTIFIER = "pro";
const ENTITLEMENT_DISPLAY_NAME = "Pro Access";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Default Offering";

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

const PRODUCTS = [
  {
    identifier: "safedrive_weekly",
    playStoreIdentifier: "safedrive_weekly:weekly",
    displayName: "SafeDrive Pro Weekly",
    title: "SafeDrive Pro Weekly",
    duration: "P1W" as const,
    packageIdentifier: "$rc_weekly",
    packageDisplayName: "Weekly Subscription",
    prices: [
      { amount_micros: 100_000_000, currency: "KES" },
    ],
  },
  {
    identifier: "safedrive_monthly",
    playStoreIdentifier: "safedrive_monthly:monthly",
    displayName: "SafeDrive Pro Monthly",
    title: "SafeDrive Pro Monthly",
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

  let testApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

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

    console.log("Adding test store prices:", JSON.stringify(prod.prices));
    const { error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testProduct.id },
      body: { prices: prod.prices },
    });

    if (priceError) {
      if (
        typeof priceError === "object" &&
        "type" in priceError &&
        (priceError as any)["type"] === "resource_already_exists"
      ) {
        console.log("Test store prices already exist");
      } else {
        throw new Error("Failed to add test store prices: " + JSON.stringify(priceError));
      }
    } else {
      console.log("Added test store prices");
    }

    allProductIds.push(testProduct.id, iosProduct.id, androidProduct.id);

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

    const { error: attachPkgError } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testProduct.id, eligibility_criteria: "all" },
          { product_id: iosProduct.id, eligibility_criteria: "all" },
          { product_id: androidProduct.id, eligibility_criteria: "all" },
        ],
      },
    });

    if (attachPkgError) {
      if (
        (attachPkgError as any).type === "unprocessable_entity_error" &&
        (attachPkgError as any).message?.includes("Cannot attach product")
      ) {
        console.log("Skipping package attach — already has product");
      } else {
        throw new Error("Failed to attach products to package: " + JSON.stringify(attachPkgError));
      }
    } else {
      console.log("Attached products to package");
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
