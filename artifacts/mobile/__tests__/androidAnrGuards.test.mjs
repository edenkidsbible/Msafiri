import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const driveMapSource = fs.readFileSync(
  new URL("../components/DriveMapView.native.tsx", import.meta.url),
  "utf8",
);
const startupMapSource = fs.readFileSync(
  new URL("../components/MapViewScreen.native.tsx", import.meta.url),
  "utf8",
);
const rootLayoutSource = fs.readFileSync(
  new URL("../app/_layout.tsx", import.meta.url),
  "utf8",
);
const dashcamContextSource = fs.readFileSync(
  new URL("../context/DashcamContext.tsx", import.meta.url),
  "utf8",
);
const homeSource = fs.readFileSync(
  new URL("../app/(tabs)/index.tsx", import.meta.url),
  "utf8",
);
const dashcamOverlaySource = fs.readFileSync(
  new URL("../components/DashcamOverlay.tsx", import.meta.url),
  "utf8",
);

test("community map markers stop bitmap tracking after their visual state settles", () => {
  assert.match(driveMapSource, /tracksViewChanges=\{!clusterMarkersFrozen\}/);
  assert.match(
    startupMapSource,
    /Platform\.OS === "android" \? !clusterMarkersFrozen : true/,
  );
});

test("custom map markers use a short bounded capture window", () => {
  for (const source of [driveMapSource, startupMapSource]) {
    assert.match(source, /setClusterMarkersFrozen\(true\)/);
    assert.match(source, /setClusterMarkersFrozen\(true\)[\s\S]{0,80}500/);
    assert.match(source, /`\$\{r\.id\}:\$\{r\.type\}:/);
  }
});

test("the Android startup map never tracks every speed-zone marker forever", () => {
  assert.match(
    startupMapSource,
    /tracksViewChanges=\{Platform\.OS !== "android"\}/,
  );
  assert.doesNotMatch(startupMapSource, /tracksViewChanges=\{true\}/);
});

test("the Android startup map bounds off-screen native zone markers", () => {
  assert.match(startupMapSource, /MAX_ANDROID_ZONE_MARKERS\s*=\s*80/);
  assert.match(startupMapSource, /\.slice\(0, MAX_ANDROID_ZONE_MARKERS\)/);
});

test("Android cold start does not eagerly load the dashcam camera module", () => {
  assert.doesNotMatch(rootLayoutSource, /import DashcamOverlay from/);
  assert.match(rootLayoutSource, /React\.lazy\(\(\) => import\("@\/components\/DashcamOverlay"\)\)/);
  assert.match(rootLayoutSource, /if \(!isDashcamOpen && !isRecording && !backgroundRecordPending\) return null/);
  assert.match(dashcamContextSource, /if \(Platform\.OS === "ios"\) \{/);
  assert.doesNotMatch(dashcamContextSource, /if \(Platform\.OS !== "web"\) \{[\s\S]{0,120}require\("expo-camera"\)/);
});

test("Home requests dashcam permissions after Start Driving and before the checklist", () => {
  const startDriving = homeSource.match(
    /const startDriving = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/,
  )?.[1] ?? "";
  assert.match(startDriving, /await requestDashcamPermissions\(\)/);
  assert.match(startDriving, /router\.push\("\/pretrip-check"\)/);
  assert.match(homeSource, /AsyncStorage\.getItem\(DASHCAM_AUTOSTART_KEY\)/);
  assert.match(homeSource, /const camera = await refreshDashcamCameraPermission\(\)/);
  assert.match(homeSource, /if \(!alive \|\| !camera\.granted\) return/);
});

test("a native camera startup stall cannot leave Dashcam pending forever", () => {
  assert.match(dashcamContextSource, /if \(!backgroundRecordPending\) return/);
  assert.match(dashcamContextSource, /setBackgroundRecordPending\(false\)/);
  assert.match(dashcamContextSource, /Dashcam couldn't start/);
  assert.match(dashcamContextSource, /\}, 15_000\)/);
});

test("Drive auto-start consumes a verified grant without prompting", () => {
  const startBackground = dashcamContextSource.match(
    /const startBackgroundRecording = useCallback\(async \(\): Promise<boolean> => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/,
  )?.[1] ?? "";
  assert.match(startBackground, /refreshDashcamCameraPermission/);
  assert.match(startBackground, /if \(!cameraState\?\.granted\) return false/);
  assert.doesNotMatch(startBackground, /requestCameraPermission/);
  assert.doesNotMatch(startBackground, /requestMicPermission/);
});

test("Dashcam ready, cancel, failure, and retry paths cannot strand pending state", () => {
  const startDashcam = dashcamContextSource.match(
    /const startDashcam = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/,
  )?.[1] ?? "";
  assert.match(startDashcam, /setBackgroundRecordPending\(false\)/);
  assert.match(dashcamContextSource, /if \(!isRecordingRef\.current\) \{[\s\S]{0,300}setBackgroundRecordPending\(false\)/);
  assert.match(dashcamOverlaySource, /onMountError=\{\(event: any\) => \{[\s\S]{0,160}clearBackgroundRecordPending\(\)/);
  assert.match(dashcamOverlaySource, /setCameraAttempt\(\(attempt\) => attempt \+ 1\)[\s\S]{0,80}startBackgroundRecording\(\)/);
});