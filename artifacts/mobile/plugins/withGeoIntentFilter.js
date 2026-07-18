const { withAndroidManifest } = require("expo/config-plugins");

// Registers Msafiri as a handler for geo: URIs on Android.
//
// When another app (WhatsApp, Telegram, SMS, etc.) shares a location on
// Android, the OS fires an Intent with:
//   Action:  android.intent.action.VIEW
//   Scheme:  geo
//   Data:    geo:lat,lng   or   geo:0,0?q=lat,lng(Label)
//
// Any app that declares this intent filter appears in the system "Open with"
// chooser alongside Google Maps, Waze, and other navigation apps. Without
// this filter, Msafiri is invisible to that prompt no matter what scheme
// or URL handling is configured in Expo Router.
//
// The filter is added to the MainActivity because that is the entry point
// Expo Router uses to receive incoming intents and pass them to Linking.
// Expo's own default intent filter (VIEW / http / https) lives on the same
// activity, so adding a second filter for the geo scheme is safe and follows
// the same pattern used by Google Maps and Waze.
//
// No changes are needed for iOS: Apple Maps handles geo: links at the OS
// level on iOS, and routing apps are surfaced through a separate mechanism
// (MKDirectionsApplicationSupportedModes in Info.plist — see app.json).

function withGeoIntentFilter(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) return config;

    // Find the MainActivity (the one with android.intent.action.MAIN)
    const activities = application.activity ?? [];
    const mainActivity = activities.find((a) =>
      (a["intent-filter"] ?? []).some((f) =>
        (f.action ?? []).some(
          (act) => act.$?.["android:name"] === "android.intent.action.MAIN"
        )
      )
    );

    if (!mainActivity) return config;

    if (!mainActivity["intent-filter"]) {
      mainActivity["intent-filter"] = [];
    }

    // Avoid duplicates on repeated prebuild runs
    const alreadyHasGeo = mainActivity["intent-filter"].some((f) =>
      (f.data ?? []).some((d) => d.$?.["android:scheme"] === "geo")
    );
    if (alreadyHasGeo) return config;

    mainActivity["intent-filter"].push({
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      category: [
        { $: { "android:name": "android.intent.category.DEFAULT" } },
        { $: { "android:name": "android.intent.category.BROWSABLE" } },
      ],
      data: [{ $: { "android:scheme": "geo" } }],
    });

    return config;
  });
}

module.exports = withGeoIntentFilter;
