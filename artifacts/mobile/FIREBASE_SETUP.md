# Android Push Notifications — Firebase Setup

Android standalone builds (APK / AAB) require a real Firebase project to receive
push notifications. Expo Go works without this because it runs inside Expo's own
app which ships with Expo's Firebase credentials. Your own binary has none.

---

## One-time setup (do this once, then every EAS build picks it up automatically)

### Step 1 — Create a Firebase project

1. Go to https://console.firebase.google.com
2. **Add project** → name it "Msafiri Kenya" (or similar)
3. Disable Google Analytics if you don't need it → **Create project**

### Step 2 — Register the Android app

1. In your Firebase project → click the **Android icon** (Add app)
2. Android package name: **`com.msafirikenya.app`**
3. App nickname: Msafiri Kenya (optional)
4. Leave SHA-1 blank for now → **Register app**
5. **Download `google-services.json`**
6. Place it at: **`artifacts/mobile/google-services.json`**
   (it is already referenced in `app.json` → `android.googleServicesFile`)

> ⚠️  Do NOT commit `google-services.json` to a public repo — add it to `.gitignore`.

### Step 3 — Upload FCM V1 credentials to EAS (so Expo can send via FCM)

FCM V1 (HTTP API v2) replaced the old server key. EAS needs a service account key.

1. Firebase Console → **Project Settings** (gear icon) → **Service accounts** tab
2. Click **Generate new private key** → confirm → download the JSON file
3. In your terminal (from `artifacts/mobile/`):

```bash
eas credentials --platform android
```

4. Select: **Manage your FCM V1 service account key**
5. Select: **Upload a FCM V1 service account key**
6. Paste the path to the downloaded service account JSON

### Step 4 — Rebuild

```bash
# Preview APK
eas build --platform android --profile preview

# Production AAB
eas build --platform android --profile production
```

---

## How to verify it worked

After installing the new build:

1. Open the app → grant notification permission when prompted
2. Watch the EAS / Metro logs for:
   - ✅ No `getExpoPushTokenAsync FAILED` error
   - ✅ A `POST /api/push/register` call appears in the API server logs with `platform: "android"`
3. The push_tokens table should now have a row with the device's Android token

---

## Why iOS and Expo Go work without this

- **Expo Go**: Uses Expo's own Firebase credentials → works for testing only
- **iOS standalone**: Uses APNs (Apple Push Notification service), not FCM → separate credentials, already configured
- **Android standalone**: Requires YOUR Firebase project → was missing → fixed by this setup
