module.exports = {
  expo: {
    name: "Msafiri",
    slug: "msafiri-kenya",
    owner: "alfrex-labs",
    version: "2.0.0",
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
      // 92 is the seed value. EAS autoIncrement (production profile) bumps
      // this to 93 before the next build artifact is produced.
      buildNumber: "92",
      supportsTablet: false,
      config: {
        googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
      },
      infoPlist: {
        // ── Location ────────────────────────────────────────────────────────
        NSLocationWhenInUseUsageDescription:
          "Msafiri uses your GPS location to display your real-time speed, alert you to nearby speed cameras, police checkpoints, and road hazards reported by other drivers, and provide turn-by-turn navigation guidance. Location is only used while the app is in the foreground.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Msafiri uses background location to keep navigation voice cues and speed alerts active when your screen locks, and to share your live position with trusted contacts during Trip Sharing. Your location data is never used for advertising or sold to third parties.",
        NSLocationAlwaysUsageDescription:
          "Msafiri uses background location to keep navigation voice cues and speed alerts active when your screen locks, and to share your live position with trusted contacts during Trip Sharing. Your location data is never used for advertising or sold to third parties.",
        // "location" keeps watchPositionAsync alive when screen locks (nav cues).
        // "audio" lets the TTS voice play through even when the app is backgrounded
        // or the screen is off — required for navigation voice on a locked phone.

        // ── Contacts ────────────────────────────────────────────────────────
        NSContactsUsageDescription:
          "Msafiri reads your address book only when you choose a contact to add as an emergency SOS contact. These contacts receive a message with your GPS coordinates if you trigger the SOS button while driving. Msafiri does not store, upload, or share your full contacts list.",

        // ── Camera ──────────────────────────────────────────────────────────
        // Two distinct in-app uses must be declared to pass App Store review.
        NSCameraUsageDescription:
          "Msafiri uses your camera for two purposes: (1) Dashcam — records continuous footage while you drive; clips are stored on your device and only uploaded when you choose to lock one. (2) Crash Assistant — lets you photograph accident scenes and vehicles when documenting an incident for your records or insurance.",

        // ── Microphone ──────────────────────────────────────────────────────
        // Two distinct in-app uses must be declared to pass App Store review.
        NSMicrophoneUsageDescription:
          "Msafiri uses your microphone for two purposes: (1) Dashcam audio — optionally records sound alongside dashcam video so you can hear what was happening during a clip. (2) Crash Assistant — lets you record a voice statement as part of an accident report for your own records.",

        // ── Photo Library ───────────────────────────────────────────────────
        // Two distinct in-app uses must be declared to pass App Store review.
        NSPhotoLibraryUsageDescription:
          "Msafiri accesses your photo library for two purposes: (1) Profile photo — lets you add a personal photo to your driver profile. (2) Crash Assistant — lets you attach photos from your library as evidence when documenting an accident.",

        UIBackgroundModes: ["location", "audio"],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.msafirikenya.app",
      // 92 is the seed value. EAS autoIncrement bumps this to 93 on next build.
      versionCode: 92,
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
            "Msafiri uses your GPS location to display your real-time speed, alert you to nearby speed cameras, police checkpoints, and road hazards, and provide turn-by-turn navigation. Location is only used while the app is in the foreground.",
          locationAlwaysAndWhenInUsePermission:
            "Msafiri uses background location to keep navigation voice cues and speed alerts active when your screen locks, and to share your live position with trusted contacts during Trip Sharing. Your location data is never used for advertising or sold to third parties.",
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
          // Android shows these strings in the runtime permission dialog.
          cameraPermission:
            "Msafiri uses your camera to record dashcam footage while driving and to photograph accident scenes in the Crash Assistant.",
          microphonePermission:
            "Msafiri records audio alongside dashcam clips and captures voice statements in the Crash Assistant accident report.",
          recordAudioAndroid: true,
        },
      ],
      [
        "expo-image-picker",
        {
          // Android shows this string in the runtime permission dialog.
          photosPermission:
            "Msafiri accesses your photo library to set your profile photo and to attach accident evidence photos in the Crash Assistant.",
          // Profile photo only needs the photo library, not the camera/mic.
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        "expo-contacts",
        {
          // Android shows this string in the runtime permission dialog.
          contactsPermission:
            "Msafiri reads your contacts only when you add an emergency SOS contact. These contacts receive your GPS location if you trigger the SOS button while driving. Your contacts list is never stored or shared.",
        },
      ],
      "expo-video",
      "@react-native-community/datetimepicker",
      "./plugins/withDisableUnusedAudioServices.js",
      "./plugins/withR8Optimization.js",
      "./plugins/withGeoIntentFilter.js",
    ],
    updates: {
      url: "https://u.expo.dev/35b79893-fc03-4518-bfcd-31ac65c262f4",
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
        projectId: "35b79893-fc03-4518-bfcd-31ac65c262f4",
      },
    },
  },
};
