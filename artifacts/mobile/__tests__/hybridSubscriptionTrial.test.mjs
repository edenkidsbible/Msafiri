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

test("a non-subscriber cannot enter through the former free-drive dismissal", () => {
  assert.match(
    layout,
    /if \(!isSubscribed && !wasSubscribed\.current\) \{[\s\S]*?router\.replace\("\/paywall"\)/,
  );
  assert.doesNotMatch(paywall, /Start Free Drive/);
  assert.doesNotMatch(paywall, /void handleEnterApp\(\);[\s\S]*?return;[\s\S]*?Subscription Required/);
});

test("three-drive cap is enforced only while the store trial is active", () => {
  assert.match(drive, /const \{ isSubscribed, isOnTrial, trialExpiredUnpaid \} = useSubscription\(\)/);
  assert.match(drive, /isOnTrialRef\.current && trialExpiredRef\.current/);
  assert.match(drive, /Trial drive limit reached/);
  assert.match(drive, /Trial Drive \{sessionsUsed \+ 1\} of \{FREE_TRIAL_SESSIONS\}/);
});