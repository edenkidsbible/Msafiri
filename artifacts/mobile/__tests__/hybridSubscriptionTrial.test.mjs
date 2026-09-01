import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paywall = readFileSync(
  new URL("../app/paywall.tsx", import.meta.url),
  "utf8",
);
const modal = readFileSync(
  new URL("../components/PaywallModal.tsx", import.meta.url),
  "utf8",
);
const layout = readFileSync(
  new URL("../app/_layout.tsx", import.meta.url),
  "utf8",
);
const drive = readFileSync(
  new URL("../app/(tabs)/drive.tsx", import.meta.url),
  "utf8",
);

test("store zero-price intro metadata is presented as a free trial", () => {
  for (const source of [paywall, modal]) {
    assert.match(source, /chosenIntroPrice\?\.price === 0/);
    assert.match(source, /No charge today/);
    assert.match(source, /free trial includes up to/);
    assert.doesNotMatch(source, /rawMonthlyIntroPrice\.price > 0/);
  }
});

test("iOS enters the app without RevenueCat while Android keeps its subscription gate", () => {
  assert.match(
    layout,
    /if \(!IOS_FREE_DRIVE_ACCESS && !isSubscribed && !wasSubscribed\.current\)/,
  );
  assert.match(layout, /if \(subLoading && !IOS_FREE_DRIVE_ACCESS\) return/);
  assert.match(paywall, /if \(Platform\.OS === "ios"\) \{[\s\S]*?router\.replace\("\/\(tabs\)"\)/);
  assert.doesNotMatch(paywall, /Start Free Drive/);
});

test("three-drive cap covers iOS free access and active store trials", () => {
  assert.match(drive, /const \{ isSubscribed, isOnTrial, trialExpiredUnpaid \} = useSubscription\(\)/);
  assert.match(drive, /IOS_FREE_DRIVE_ACCESS &&[\s\S]*?!isSubscribedRef\.current &&[\s\S]*?trialExpiredRef\.current/);
  assert.match(drive, /isOnTrialRef\.current && trialExpiredRef\.current/);
  assert.match(drive, /Trial drive limit reached/);
  assert.match(drive, /Free Drive \{sessionsUsed \+ 1\} of \{FREE_TRIAL_SESSIONS\}/);
});