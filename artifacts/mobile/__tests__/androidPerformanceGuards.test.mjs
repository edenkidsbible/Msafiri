import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const version = readFileSync(new URL("../hooks/useAppVersion.ts", import.meta.url), "utf8");
const drive = readFileSync(new URL("../app/(tabs)/drive.tsx", import.meta.url), "utf8");
const appContext = readFileSync(new URL("../context/AppContext.tsx", import.meta.url), "utf8");

test("network OTA checks do not hold the native splash screen", () => {
  assert.match(layout, /fontPromise\.then\(\(\) => \{[\s\S]*?setReady\(true\)/);
  assert.match(layout, /setTimeout\(\(\) => \{[\s\S]*?checkForOTAUpdate\(\)/);
  assert.doesNotMatch(layout, /Promise\.all\(\[fontPromise,\s*updatePromise\]\)/);
});

test("heavy alert audio setup waits until initial interactions finish", () => {
  assert.match(layout, /InteractionManager\.runAfterInteractions/);
  assert.match(layout, /setTimeout\(\(\) => prewarmAlertAudio\(\), 1500\)/);
});

test("startup and driving network churn remain bounded", () => {
  assert.match(version, /apiGet<VersionCheckResult[\s\S]*?3000,/);
  assert.match(drive, /refreshRoadChannelsSetting\(\);[\s\S]*?60_000/);
  assert.match(appContext, /lastLocationAtRef\.current > 20_000/);
});