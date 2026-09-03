import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readApi = (path) =>
  readFile(new URL(`../../api-server/src/${path}`, import.meta.url), "utf8");

test("automatic hazard generation and telemetry ingestion stay disabled", async () => {
  const [serverIndex, telemetry, appContext] = await Promise.all([
    readApi("index.ts"),
    readApi("routes/telemetry.ts"),
    read("context/AppContext.tsx"),
  ]);

  const disabledHazardRoute = telemetry.split("// ── POST /telemetry/crash-trigger")[0];
  assert.doesNotMatch(serverIndex, /startClusterHazardsJob/);
  assert.match(disabledHazardRoute, /disabled:\s*true/);
  assert.doesNotMatch(disabledHazardRoute, /brakingEventsTable|\.insert\(/);
  assert.doesNotMatch(appContext, /hazardBatchRef|flushHazardBatch|telemetry\/braking-events/);
});

test("driver feeds and both mobile maps reject automatic reports", async () => {
  const [reportsRoute, appContext, homeMap, driveMap] = await Promise.all([
    readApi("routes/reports.ts"),
    read("context/AppContext.tsx"),
    read("components/MapViewScreen.native.tsx"),
    read("components/DriveMapView.native.tsx"),
  ]);

  assert.ok(
    (reportsRoute.match(/ne\(communityReportsTable\.source,\s*"auto"\)/g) ?? []).length >= 2,
    "both global and location-filtered report queries must reject auto reports",
  );
  assert.match(appContext, /report\.source === "auto"/);
  assert.match(appContext, /roadName\?\.startsWith\("Auto-detected:"\)/);
  assert.match(homeMap, /r\.source !== "auto"/);
  assert.match(driveMap, /r\.source !== "auto"/);
});