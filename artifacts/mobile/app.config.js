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
        googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY || "AIzaSyAqD6Eo_ZMUvoqHO_jLdPUAXTQVo-Ej3Dg",
      },
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          "Msafiri uses your location to show your real-time speed and detect nearby speed cameras and police checkpoints.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Msafiri uses your location in the background so your live-sharing recipients continue to see your position even when the screen is locked.",
        NSLocationAlwaysUsageDescription:
          "Msafiri uses your location in the background so your live-sharing recipients continue to see your position even when the screen is locked.",
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
            "Msafiri needs location access to show your speed and detect speed cameras nearby.",
          locationAlwaysAndWhenInUsePermission:
            "Msafiri uses your location in the background while live sharing is active, so your contact can follow your trip even when the screen is locked.",
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
