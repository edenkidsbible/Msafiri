module.exports = {
  expo: {
    name: "Msafiri",
    slug: "msafiri-kenya",
    owner: "alfrex-labs",
    version: "2.0.5",
    // "default" allows all orientations at the native level.
    // expo-screen-orientation locks to portrait at startup (via _layout.tsx)
    // and temporarily unlocks to LANDSCAPE_LEFT during the drive screen when
    // the driver chooses the landscape mount option in the pre-trip checklist.
    orientation: "default",
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
      buildNumber: "50",
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
        // Every in-app microphone use must be declared to pass App Store review.
        NSCameraUsageDescription:
          "Msafiri uses your camera for two purposes: (1) Dashcam — records continuous footage while you drive; clips are stored on your device and only uploaded when you choose to lock one. (2) Crash Assistant — lets you photograph accident scenes and vehicles when documenting an incident for your records or insurance.",

        // ── Microphone ──────────────────────────────────────────────────────
        // Two distinct in-app uses must be declared to pass App Store review.
        NSMicrophoneUsageDescription:
          "Msafiri uses your microphone for: (1) Road Channels — recording a short road update that you review before sharing, (2) Dashcam audio — optionally recording sound with dashcam video, and (3) Crash Assistant — recording a voice statement for your accident records.",

        // ── Photo Library ───────────────────────────────────────────────────
        // Two distinct in-app uses must be declared to pass App Store review.
        NSPhotoLibraryUsageDescription:
          "Msafiri accesses your photo library for two purposes: (1) Profile photo — lets you add a personal photo to your driver profile. (2) Crash Assistant — lets you attach photos from your library as evidence when documenting an accident.",
        // Required when saving (not just reading) to the photo library.
        // expo-media-library's saveToLibraryAsync triggers this dialog on iOS.
        NSPhotoLibraryAddUsageDescription:
          "Save dashcam clips to your phone's video library so you can keep important footage after a trip ends.",

        UIBackgroundModes: ["location", "remote-notification", "audio"],
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: "com.msafirikenya.app",
      versionCode: 51,
      // Written at EAS build time by eas-hooks/eas-build-pre-install.sh from
      // the GOOGLE_SERVICES_JSON_BASE64 EAS secret. For local builds, place
      // the file at artifacts/mobile/google-services.json (gitignored).
      googleServicesFile: "./google-services.json",
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
        // Required to launch ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, which
        // opens the OS dialog that exempts the app from Doze / battery saver.
        // Without this, FCM high-priority messages are blocked on OEM Android
        // devices (Samsung, Tecno, Infinix, Xiaomi) when the app is killed.
        "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
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
      // Native mods are nested in reverse plugin-list order. Register this
      // before expo-notifications so its Android cleanup runs after the sound
      // files have been copied. It keeps MP3s in Android res/raw while leaving
      // the iOS CAF bundle untouched.
      "./plugins/withAndroidNotificationSounds.js",
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#00C853",
          sounds: [
            // ── Original notification tones ──────────────────────────────────
            "./assets/sounds/alert_tone.mp3",
            "./assets/sounds/confirm_chime.mp3",
            "./assets/sounds/notify_pop.mp3",

            // ── Yna Agalo alert voices — iOS (.caf) ─────────────────────────
            // iOS UNUserNotificationCenter only plays .wav / .aiff / .caf;
            // .mp3 is silently ignored. The expo-notifications plugin copies
            // each file listed here into the app bundle root at build time,
            // making them available to the `sound:` field in scheduleNotificationAsync.
            "./assets/sounds/alerts/camera.caf",
            "./assets/sounds/alerts/police.caf",
            "./assets/sounds/alerts/zone.caf",
            "./assets/sounds/alerts/alcoblow.caf",
            "./assets/sounds/alerts/accident.caf",
            "./assets/sounds/alerts/traffic.caf",
            "./assets/sounds/alerts/roadblock.caf",
            "./assets/sounds/alerts/roadworks.caf",
            "./assets/sounds/alerts/hazard.caf",
            "./assets/sounds/alerts/pothole.caf",
            "./assets/sounds/alerts/debris.caf",
            "./assets/sounds/alerts/breakdown.caf",
            "./assets/sounds/alerts/weather.caf",
            "./assets/sounds/alerts/closure.caf",
            "./assets/sounds/alerts/clear.caf",
            "./assets/sounds/alerts/speed_bump.caf",
            // Speed-limit-specific camera CAFs
            "./assets/sounds/alerts/camera_30.caf",
            "./assets/sounds/alerts/camera_50.caf",
            "./assets/sounds/alerts/camera_60.caf",
            "./assets/sounds/alerts/camera_80.caf",
            "./assets/sounds/alerts/camera_100.caf",
            "./assets/sounds/alerts/camera_110.caf",
            // Speed-limit-specific zone CAFs
            "./assets/sounds/alerts/zone_30.caf",
            "./assets/sounds/alerts/zone_50.caf",
            "./assets/sounds/alerts/zone_60.caf",
            "./assets/sounds/alerts/zone_80.caf",
            "./assets/sounds/alerts/zone_100.caf",
            "./assets/sounds/alerts/zone_110.caf",

            // ── Yna Agalo alert voices — Android (.mp3 → res/raw/) ──────────
            // Android 8+ uses notification-channel sounds; files must be in
            // res/raw/ (copied here by the expo-notifications plugin).
            // Each msafiri_voice_<type> channel references its file by name.
            "./assets/sounds/alerts/camera.mp3",
            "./assets/sounds/alerts/police.mp3",
            "./assets/sounds/alerts/zone.mp3",
            "./assets/sounds/alerts/alcoblow.mp3",
            "./assets/sounds/alerts/accident.mp3",
            "./assets/sounds/alerts/traffic.mp3",
            "./assets/sounds/alerts/roadblock.mp3",
            "./assets/sounds/alerts/roadworks.mp3",
            "./assets/sounds/alerts/hazard.mp3",
            "./assets/sounds/alerts/pothole.mp3",
            "./assets/sounds/alerts/debris.mp3",
            "./assets/sounds/alerts/breakdown.mp3",
            "./assets/sounds/alerts/weather.mp3",
            "./assets/sounds/alerts/closure.mp3",
            "./assets/sounds/alerts/clear.mp3",
            "./assets/sounds/alerts/speed_bump.mp3",
          ],
        },
      ],
      "expo-updates",
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
      // Native manifest mods run in reverse plugin order. This must be
      // registered before expo-image-picker so it restores the dashcam's
      // Android permissions after image-picker's opt-out removals are applied.
      "./plugins/withRequiredDashcamPermissions.js",
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
      "expo-screen-orientation",
      "expo-video",
      "@react-native-community/datetimepicker",
      "./plugins/withDisableUnusedAudioServices.js",
      "./plugins/withR8Optimization.js",
      "./plugins/withGeoIntentFilter.js",
      "./plugins/withNoReadMediaPermissions.js",
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
