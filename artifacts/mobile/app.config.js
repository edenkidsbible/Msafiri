module.exports = {
  expo: {
    name: "Msafiri",
    slug: "msafiri-kenya",
    owner: "edenkids-organization",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "msafiri",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#FFFFFF",
    },
    ios: {
      bundleIdentifier: "com.msafirikenya.app",
      buildNumber: "1",
      supportsTablet: false,
      config: {
        googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
      },
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "Msafiri uses your location to show your real-time speed and alert you to nearby speed cameras, police checkpoints, and road hazards reported by other drivers.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Msafiri uses your location in the background only while Live Trip Sharing is active, so the people following your trip can see your position even when your screen is locked.",
        NSLocationAlwaysUsageDescription:
          "Msafiri uses your location in the background only while Live Trip Sharing is active, so the people following your trip can see your position even when your screen is locked.",
        UIBackgroundModes: ["location"],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.msafirikenya.app",
      versionCode: 1,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.RECEIVE_BOOT_COMPLETED",
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon-foreground.png",
        backgroundColor: "#FFFFFF",
      },
      config: {
        googleMaps: {
          apiKey: "AIzaSyAqD6Eo_ZMUvoqHO_jLdPUAXTQVo-Ej3Dg",
        },
      },
    },
    web: {
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      [
        "expo-router",
        {
          origin: "https://replit.com/",
        },
      ],
      "expo-font",
      "expo-web-browser",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Msafiri uses your location to show your real-time speed and alert you to nearby speed cameras, police checkpoints, and road hazards reported by other drivers.",
          locationAlwaysAndWhenInUsePermission:
            "Msafiri uses your location in the background only while Live Trip Sharing is active, so the people following your trip can see your position even when your screen is locked.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#00C853",
          sounds: [
            "./assets/sounds/alert_tone.mp3",
            "./assets/sounds/confirm_chime.mp3",
            "./assets/sounds/notify_pop.mp3",
          ],
        },
      ],
      "expo-updates",
      "@react-native-community/datetimepicker",
      "./plugins/withDisableUnusedAudioServices.js",
      "./plugins/withR8Optimization.js",
      "./plugins/withGeoIntentFilter.js",
      [
        "@sentry/react-native/expo",
        {
          organization: "alfrex-labs",
          project: "react-native",
        },
      ],
    ],
    updates: {
      url: "https://u.expo.dev/465586c3-648b-459e-b3c9-1983e1a62ffb",
    },
    runtimeVersion: {
      policy: "appVersion",
    },
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      eas: {
        projectId: "465586c3-648b-459e-b3c9-1983e1a62ffb",
      },
    },
  },
};
