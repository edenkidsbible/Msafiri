module.exports = {
  expo: {
    name: "Msafiri",
    slug: "msafiri-kenya",
    owner: "edenkids-organization",
    version: "1.0.2",
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
        // "location" keeps watchPositionAsync alive when screen locks (nav cues).
        // "audio" lets the TTS voice play through even when the app is backgrounded
        // or the screen is off — required for navigation voice on a locked phone.
        NSContactsUsageDescription:
          "Msafiri lets you pick emergency contacts directly from your address book so you don't have to type phone numbers manually.",
        NSCameraUsageDescription:
          "Msafiri uses your camera to record dashcam footage while you drive. Recordings are stored locally on your device and only uploaded to the cloud when you manually lock a clip.",
        NSMicrophoneUsageDescription:
          "Msafiri can optionally record audio with dashcam footage so you can hear what was happening at the time of an incident.",
        NSPhotoLibraryUsageDescription:
          "Msafiri lets you choose a photo from your library to use as your profile picture.",
        UIBackgroundModes: ["location", "audio"],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.msafirikenya.app",
      versionCode: 27,
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
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_CONTACTS",
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
      [
        "@sentry/react-native/expo",
        {
          // Org/project + SENTRY_AUTH_TOKEN are only needed for source-map
          // upload during EAS builds; without them the build still succeeds
          // and native crash capture works (stacks are symbolicated for the
          // native side; JS frames need the auth token to be symbolicated).
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          url: "https://sentry.io/",
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "Msafiri uses your camera to record dashcam footage while you drive.",
          microphonePermission:
            "Msafiri can optionally record audio with dashcam footage.",
          recordAudioAndroid: true,
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission:
            "Msafiri lets you choose a photo from your library to use as your profile picture.",
          // Profile photo only needs the photo library, not the camera/mic.
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        "expo-contacts",
        {
          contactsPermission:
            "Msafiri lets you pick emergency contacts directly from your address book so you don't have to type phone numbers manually.",
        },
      ],
      "expo-video",
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
