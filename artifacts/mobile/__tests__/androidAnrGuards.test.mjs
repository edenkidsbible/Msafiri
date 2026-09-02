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