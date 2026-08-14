# Android Push Notifications — Firebase Setup

Android standalone builds (APK / AAB) require a real Firebase project to receive
push notifications. Expo Go works without this because it runs inside Expo's own
app which ships with Expo's Firebase credentials. Your own binary has none.

---

## One-time setup (do this once, then every EAS build picks it up automatically)

### Step 1 — Create a Firebase project (skip if you already have one)

1. Go to https://console.firebase.google.com
2. **Add project** → name it "Msafiri Kenya"
3. Disable Google Analytics if you don't need it → **Create project**

### Step 2 — Register the Android app

1. In your Firebase project → click the **Android icon** (Add app)
2. Android package name: **`com.msafirikenya.app`**
3. App nickname: Msafiri Kenya (optional)
4. Leave SHA-1 blank → **Register app**
5. **Download `google-services.json`**

### Step 3 — Upload google-services.json as an EAS secret

EAS builds run on remote servers and can't read local files directly. Store the
file's contents as a base64-encoded EAS project secret so every future build
picks it up automatically.

Run this **once** from the `artifacts/mobile/` directory (replace the path with
wherever you saved the file):

```bash
cd artifacts/mobile

eas secret:create \
  --scope project \
  --name GOOGLE_SERVICES_JSON_BASE64 \
  --value "$(base64 < /path/to/google-services.json)"
```

> On macOS, `base64` works as-is.
> On Linux you may need `base64 -w 0 < /path/to/google-services.json`.

The EAS build hook (`eas-hooks/eas-build-pre-install.sh`) automatically decodes
this secret and writes `google-services.json` before the native build starts.

### Step 4 — Upload FCM V1 credentials to EAS

This authorises the Expo Push Service to send notifications via Firebase Cloud
Messaging on behalf of your app. Without this, Expo can't reach Android devices.

1. Firebase Console → **Project Settings** (gear icon) → **Service accounts** tab
2. Click **Generate new private key** → confirm → download the JSON file
3. Run (from `artifacts/mobile/`):

```bash
eas credentials --platform android
```

4. Choose: **Manage your FCM V1 service account key**
5. Choose: **Upload a FCM V1 service account key**
6. Paste the path to the downloaded service-account JSON

### Step 5 — Rebuild and submit

```bash
# Production AAB (Play Store)
eas build --platform android --profile production

# Preview APK (internal testing)
eas build --platform android --profile preview
```

Then submit the new AAB to the Play Store and roll it out.

---

## How to verify it worked

After installing the new build:

1. Open the app → grant notification permission when prompted
2. Check the API server logs for:
   - ✅ `POST /api/push/register` with `platform: "android"`
3. Check the `push_tokens` table — a new row should appear with `platform = 'android'`
4. Run a manual test push from the Admin → Push Campaigns page

---

## Why iOS works without this

- **iOS standalone**: Uses APNs (Apple Push Notification service), not FCM —
  separate credentials already configured via EAS.
- **Expo Go** (development only): Uses Expo's own Firebase credentials.
- **Android standalone**: Requires YOUR Firebase project → was missing → now fixed.
