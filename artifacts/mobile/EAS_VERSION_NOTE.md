# EAS Remote Version Counter — Action Required

`eas.json` sets `"appVersionSource": "remote"`, which means EAS tracks the
build number/version code on its servers and **ignores** the iOS/Android counter
values in `app.config.js` during production builds. The values in
`app.config.js` are used for local development only.

The production profile also has `"autoIncrement": true`, meaning EAS will
**increment the remote counter by 1** at the start of every production build.

## Correct sequence to land on build 93

Because of `autoIncrement: true`, you must pre-seed the remote counter to **92**
so the next production build auto-increments to **93**.

Run the following commands (requires EAS CLI ≥ 13, logged in via `eas login`).
Each command is **interactive** — it will prompt you for the counter value.

```bash
# Seed iOS build number to 92  (auto-increment → 93 on next build)
eas build:version:set -p ios
# When prompted:
#   Application build version (iOS buildNumber): 92

# Seed Android version code to 92  (auto-increment → 93 on next build)
eas build:version:set -p android
# When prompted:
#   Version code (Android versionCode): 92
```

After running both commands, the **next** `eas build --platform all --profile production`
will produce iOS buildNumber **93** and Android versionCode **93**.

## Alternative: disable auto-increment for one build

If you want to set 93 directly without relying on the increment, temporarily
remove `"autoIncrement": true` from the production profile in `eas.json`, seed
the counter to 93, run the build, then restore `"autoIncrement": true`.

## Summary of config changes in this bump

| Field                  | Old value | New value |
|------------------------|-----------|-----------|
| `version`              | 1.0.2     | 2.0.0     |
| iOS `buildNumber`      | "1"       | "93"      |
| Android `versionCode`  | 27        | 93        |

> The local `app.config.js` values (93) serve as documentation of intent and
> are used during local `expo run` / Expo Go sessions. For production EAS builds
> the remote counter is authoritative — follow the steps above.
