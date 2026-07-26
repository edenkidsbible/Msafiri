/**
 * withLiveActivity — Expo config plugin
 *
 * Performs all Xcode project modifications required to support iOS Dynamic
 * Island Live Activities:
 *
 *  1. Sets NSSupportsLiveActivities = true in the main app's Info.plist.
 *  2. Adds a Widget Extension target to the Xcode project.
 *  3. Configures the extension's Info.plist (bundle id, NSExtension dict).
 *  4. Links both the app and the extension to the shared App Group so
 *     ActivityKit data flows correctly (group.com.msafirikenya.app).
 *  5. Copies the SwiftUI source files from targets/MsafiriWidget/ into the
 *     Xcode project so EAS Build can compile them.
 *
 * The plugin is idempotent — repeated prebuild runs do not add duplicate
 * targets or Info.plist keys.
 */

const {
  withInfoPlist,
  withXcodeProject,
  withEntitlementsPlist,
} = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

const WIDGET_TARGET_NAME = "MsafiriWidget";
const WIDGET_BUNDLE_ID = "com.msafirikenya.app.widget";
const APP_GROUP_ID = "group.com.msafirikenya.app";
const WIDGET_SOURCE_DIR = path.join(
  __dirname,
  "..",
  "targets",
  "MsafiriWidget"
);

// ── Step 1: NSSupportsLiveActivities in main app Info.plist ──────────────────

function withLiveActivitiesInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    return config;
  });
}

// ── Step 2: App Group entitlement on the main app ────────────────────────────

function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    const key = "com.apple.security.application-groups";
    const current = config.modResults[key] ?? [];
    if (!current.includes(APP_GROUP_ID)) {
      config.modResults[key] = [...current, APP_GROUP_ID];
    }
    return config;
  });
}

// ── Step 3: Widget Extension Xcode target ────────────────────────────────────

function withWidgetExtensionTarget(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;

    // Avoid adding the target a second time on repeated prebuild runs.
    const existingTargets = project.pbxNativeTargetSection();
    const alreadyExists = Object.values(existingTargets).some(
      (t) => t && t.name === WIDGET_TARGET_NAME
    );
    if (alreadyExists) return config;

    // ── Collect source files from targets/MsafiriWidget/ ──────────────────
    const swiftFiles = fs
      .readdirSync(WIDGET_SOURCE_DIR)
      .filter((f) => f.endsWith(".swift"));

    // ── Create the extension group / files ───────────────────────────────
    // addPluginFile is not available; we use the lower-level pbxjs API.
    // expo-modules-core config plugins use the same approach.
    const { uuid } = require("expo/config-plugins").IOSConfig;

    // Add a PBXGroup for the widget sources
    const widgetGroupUuid = project.generateUuid();
    project.pbxCreateGroup(WIDGET_TARGET_NAME, WIDGET_TARGET_NAME);

    // Add Swift source files to the group
    swiftFiles.forEach((fileName) => {
      const srcPath = path.join(WIDGET_SOURCE_DIR, fileName);
      // Copy file into ios/<WidgetTargetName>/ so Xcode finds it after prebuild
      const destDir = path.join(
        config.modRequest.projectRoot,
        "ios",
        WIDGET_TARGET_NAME
      );
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, path.join(destDir, fileName));
    });

    // ── Widget Info.plist ─────────────────────────────────────────────────
    const destDir = path.join(
      config.modRequest.projectRoot,
      "ios",
      WIDGET_TARGET_NAME
    );
    const infoPlistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>MsafiriWidget</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>${WIDGET_BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>`;
    fs.writeFileSync(path.join(destDir, "Info.plist"), infoPlistContent);

    // ── Widget entitlements (App Group) ───────────────────────────────────
    const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP_ID}</string>
  </array>
</dict>
</plist>`;
    fs.writeFileSync(
      path.join(destDir, `${WIDGET_TARGET_NAME}.entitlements`),
      entitlements
    );

    // ── Add target via pbxjs ─────────────────────────────────────────────
    // addTarget returns a NativeTarget object with the UUID we need for the
    // build phases.
    const widgetTarget = project.addTarget(
      WIDGET_TARGET_NAME,
      "app_extension",
      WIDGET_TARGET_NAME,
      WIDGET_BUNDLE_ID
    );

    // Add build phase: compile sources
    project.addBuildPhase(
      swiftFiles.map((f) => `${WIDGET_TARGET_NAME}/${f}`),
      "PBXSourcesBuildPhase",
      "Sources",
      widgetTarget.uuid
    );

    // Add build phase: resources (Info.plist is handled by Xcode automatically)
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      widgetTarget.uuid
    );

    // Add build phase: frameworks (WidgetKit + SwiftUI are in the SDK)
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      widgetTarget.uuid
    );

    // Build settings for the extension target
    const commonSettings = {
      ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: "NO",
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: "1",
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `${WIDGET_TARGET_NAME}/Info.plist`,
      CODE_SIGN_ENTITLEMENTS: `${WIDGET_TARGET_NAME}/${WIDGET_TARGET_NAME}.entitlements`,
      IPHONEOS_DEPLOYMENT_TARGET: "16.2",
      MARKETING_VERSION: "1.0.1",
      PRODUCT_BUNDLE_IDENTIFIER: WIDGET_BUNDLE_ID,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: "YES",
      SWIFT_EMIT_LOC_STRINGS: "YES",
      SWIFT_VERSION: "5.9",
      TARGETED_DEVICE_FAMILY: "1",
    };

    // Apply build settings only to the widget target's own configurations.
    // We walk: widgetTarget → buildConfigurationList UUID → each config UUID
    // → XCBuildConfiguration → buildSettings.  This avoids the broken PRODUCT_NAME
    // filter that was previously writing widget-only settings (IPHONEOS_DEPLOYMENT_TARGET
    // 16.2, SWIFT_VERSION 5.9, etc.) into the main app's build configurations.
    const allTargetSection = project.pbxNativeTargetSection();
    const widgetNativeTarget = Object.values(allTargetSection).find(
      (t) => t && t.name === WIDGET_TARGET_NAME
    );
    if (widgetNativeTarget && widgetNativeTarget.buildConfigurationList) {
      const configListUuid = widgetNativeTarget.buildConfigurationList;
      const configList = project.pbxXCConfigurationListSection()[configListUuid];
      if (configList && Array.isArray(configList.buildConfigurations)) {
        configList.buildConfigurations.forEach((configRef) => {
          // buildConfigurations entries are { value: uuid, comment: "..." }
          const uuid =
            typeof configRef === "object" ? configRef.value : configRef;
          const buildConfig =
            project.pbxXCBuildConfigurationSection()[uuid];
          if (buildConfig && buildConfig.buildSettings) {
            Object.assign(buildConfig.buildSettings, commonSettings);
          }
        });
      }
    }

    return config;
  });
}

// ── Main plugin ───────────────────────────────────────────────────────────────

function withLiveActivity(config) {
  config = withLiveActivitiesInfoPlist(config);
  config = withAppGroupEntitlement(config);
  config = withWidgetExtensionTarget(config);
  return config;
}

module.exports = withLiveActivity;
