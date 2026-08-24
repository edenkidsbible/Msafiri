import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const androidSound = fs.readFileSync(new URL("../utils/sound.android.ts", import.meta.url), "utf8");
const androidVoice = fs.readFileSync(new URL("../utils/alertTts.android.ts", import.meta.url), "utf8");
const channels = fs.readFileSync(new URL("../utils/androidNotificationChannels.ts", import.meta.url), "utf8");
const backgroundAlerts = fs.readFileSync(new URL("../utils/backgroundDriveAlerts.ts", import.meta.url), "utf8");

test("Android alert audio has its own high-volume runtime", () => {
  assert.match(androidSound, /shouldPlayInBackground:\s*true/);
  assert.match(androidSound, /player\.volume = 1/);
  assert.match(androidSound, /setDashcamAudioMode/);
  assert.match(androidVoice, /player\.volume = 1/);
  assert.match(androidVoice, /remotePlayer\.volume = 1/);
});

test("Android background alerts verify the channel before scheduling", () => {
  assert.match(channels, /ANDROID_ALERTS_CHANNEL_ID/);
  assert.match(channels, /AndroidImportance\.HIGH/);
  assert.match(backgroundAlerts, /ensureAndroidNotificationChannels\(\)/);
  assert.match(backgroundAlerts, /channelId: ANDROID_ALERTS_CHANNEL_ID/);
});