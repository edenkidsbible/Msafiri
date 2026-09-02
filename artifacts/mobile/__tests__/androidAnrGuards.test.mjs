import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const mapSource = fs.readFileSync(
  new URL("../components/DriveMapView.native.tsx", import.meta.url),
  "utf8",
);

test("community map markers stop bitmap tracking after their visual state settles", () => {
  assert.match(mapSource, /tracksViewChanges=\{!clusterMarkersFrozen\}/);
  assert.doesNotMatch(
    mapSource,
    /Community report clusters[\s\S]{0,1200}tracksViewChanges=\{true\}/,
  );
});

test("custom map markers use a short bounded capture window", () => {
  assert.match(mapSource, /setClusterMarkersFrozen\(true\)/);
  assert.match(mapSource, /}, 500\)/);
  assert.match(mapSource, /`\$\{r\.id\}:\$\{r\.type\}:/);
});