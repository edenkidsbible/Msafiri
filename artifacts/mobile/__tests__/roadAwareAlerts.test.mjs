import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layoutSource = fs.readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
const appContextSource = fs.readFileSync(path.join(root, "context/AppContext.tsx"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "utils/backgroundDriveAlerts.ts"), "utf8");

function normalizeRoad(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(road|rd|street|st|avenue|ave|highway|hwy|superhighway|way|bypass|lane|drive|dr|place)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roadsMatch(aRoad, bRoad) {
  if (!aRoad || !bRoad) return false;
  const a = normalizeRoad(aRoad);
  const b = normalizeRoad(bRoad);
  if (!a || !b) return false;
  return a === b;
}

function selectRoadCandidate(currentRoad, candidates) {
  return candidates
    .filter((candidate) =>
      !candidate.road || roadsMatch(currentRoad, candidate.road)
    )
    .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

describe("single alert owner lifecycle", () => {
  it("starts background delivery only on a true background transition", () => {
    assert.match(layoutSource, /if \(next === "background"\)/);
    assert.doesNotMatch(layoutSource, /next === "background" \|\| next === "inactive"/);
  });

  it("invalidates persisted background ownership before stopping the producer", () => {
    const handoff = layoutSource.indexOf('setAlertOwner("handoff")');
    const persistedForeground = layoutSource.indexOf(
      'await AsyncStorage.setItem(BG_ALERT_OWNER_KEY, "foreground")',
      handoff,
    );
    const stop = layoutSource.indexOf("await stopBgDriveAlertsTask()", persistedForeground);
    const foregroundReady = layoutSource.indexOf('setAlertOwner("foreground")', stop);
    assert.ok(
      handoff >= 0 &&
      persistedForeground > handoff &&
      stop > persistedForeground &&
      foregroundReady > stop,
    );
  });

  it("background delivery checks ownership at entry and again before scheduling", () => {
    const ownerChecks = backgroundSource.match(/ownerRaw !== "background"|BG_ALERT_OWNER_KEY\)\) !== "background"/g) ?? [];
    assert.equal(ownerChecks.length, 2);
  });

  it("foreground voice timers and immediate chimes require active app state", () => {
    assert.match(appContextSource, /if \(!canDeliverForegroundAlert\(\) \|\| !isCurrentAlertGeneration\(generation\)\) return/);
    assert.match(appContextSource, /const foregroundOwnsAlert = canDeliverForegroundAlert\(\)/);
    assert.match(appContextSource, /stopAlertVoice\(\)/);
    assert.doesNotMatch(appContextSource, /stopSound\("alert"\)/);
  });

  it("selects CAF only on iOS and an Android channel only on Android", () => {
    assert.match(backgroundSource, /Platform\.OS === "ios"\s*\?\s*resolveIosNotificationSound/);
    assert.match(backgroundSource, /Platform\.OS === "android"\s*\?\s*resolveAndroidVoiceChannelId/);
  });
});

describe("road-aware candidate selection", () => {
  it("keeps the Mombasa Road camera even when an Expressway camera is closer", () => {
    const selected = selectRoadCandidate("Mombasa Road", [
      { id: "expressway-80", road: "Nairobi Expressway", distance: 280, speedLimit: 80 },
      { id: "mombasa-50", road: "Mombasa Road", distance: 410, speedLimit: 50 },
    ]);
    assert.equal(selected?.id, "mombasa-50");
    assert.equal(selected?.speedLimit, 50);
  });

  it("excludes a closer hazard on a parallel road", () => {
    const selected = selectRoadCandidate("Nairobi Expressway", [
      { id: "mombasa-pothole", road: "Mombasa Road", distance: 300 },
      { id: "expressway-debris", road: "Nairobi Expressway", distance: 460 },
    ]);
    assert.equal(selected?.id, "expressway-debris");
  });

  it("keeps same-road alerts available for grouping", () => {
    const candidates = [
      { id: "camera", road: "Mombasa Road", distance: 350 },
      { id: "roadworks", road: "Mombasa Rd", distance: 700 },
      { id: "expressway", road: "Nairobi Expressway", distance: 500 },
    ].filter((candidate) => roadsMatch("Mombasa Road", candidate.road));
    assert.deepEqual(candidates.map(({ id }) => id), ["camera", "roadworks"]);
  });

  it("does not treat a named branch as the same road by substring", () => {
    assert.equal(roadsMatch("Mombasa Road", "Old Mombasa Road"), false);
    assert.equal(roadsMatch("Limuru Road", "Old Limuru Road"), false);
  });

  it("requires alerts to follow the driven corridor or active route", () => {
    assert.match(appContextSource, /ALERT_ROUTE_CORRIDOR_M\s*=\s*60/);
    assert.match(appContextSource, /incident\.offRouteM/);
    assert.match(appContextSource, /lateralM\s*<=\s*75/);
    assert.match(appContextSource, /if \(!isOnDrivenPath\(z\.id, "zone"/);
    assert.match(appContextSource, /if \(!isOnDrivenPath\(r\.id, "report"/);
    assert.match(appContextSource, /if \(!isOnDrivenPath\(h\.id, "here"/);
  });

  it("allows distance/direction fallback when the current road is unavailable", () => {
    const selected = selectRoadCandidate(null, [
      { id: "unknown-road-alert", road: null, distance: 320 },
      { id: "known-road-alert", road: "Mombasa Road", distance: 450 },
    ]);
    assert.equal(selected?.id, "unknown-road-alert");
  });

  it("suppresses road-tagged parallel alerts when road context is unavailable", () => {
    const selected = selectRoadCandidate(null, [
      { id: "expressway", road: "Nairobi Expressway", distance: 280 },
      { id: "mombasa", road: "Mombasa Road", distance: 320 },
    ]);
    assert.equal(selected, null);
  });

  it("keeps road resolution pending as a hard foreground alert gate", () => {
    assert.match(appContextSource, /const roadReady = !roadWarmupPendingRef\.current/);
  });

  it("rechecks TTS ownership after ducking and before playback", () => {
    for (const file of ["utils/alertTts.ts", "utils/alertTts.android.ts"]) {
      const ttsSource = fs.readFileSync(path.join(root, file), "utf8");
      const afterDuck = ttsSource.indexOf("await duckForAlert()");
      const generationCheck = ttsSource.indexOf("isCurrentAlertGeneration(expectedGeneration)", afterDuck);
      const play = ttsSource.indexOf(".play()", generationCheck);
      assert.ok(
        afterDuck >= 0 && generationCheck > afterDuck && play > generationCheck,
        `${file} must recheck ownership after ducking and before playback`,
      );
    }
  });
});