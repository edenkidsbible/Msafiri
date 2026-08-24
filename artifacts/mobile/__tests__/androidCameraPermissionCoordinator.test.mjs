import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const mobileRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");

test("Android camera permission requests are serialized by one OS-backed coordinator", () => {
  const source = read("utils/androidCameraPermissions.ts");

  assert.match(source, /let cameraRequestInFlight:/);
  assert.match(source, /if \(cameraRequestInFlight\) return cameraRequestInFlight/);
  assert.match(source, /PermissionsAndroid\.PERMISSIONS\.CAMERA/);
  assert.match(source, /getAndroidCameraPermissionState/);
  assert.match(source, /requestAndroidMicrophonePermission/);
});

test("Dashcam UI consumes provider-owned Android camera state", () => {
  const overlay = read("components/DashcamOverlay.tsx");
  const pretrip = read("app/pretrip-check.tsx");

  assert.match(overlay, /cameraPermissionState, microphonePermissionGranted, requestDashcamPermissions/);
  assert.doesNotMatch(overlay, /PermissionsAndroid/);
  assert.match(overlay, /onMountError=/);
  assert.match(overlay, /Camera did not start/);

  assert.match(pretrip, /refreshDashcamCameraPermission/);
  assert.doesNotMatch(pretrip, /PermissionsAndroid\.(request|PERMISSIONS)/);
  assert.match(pretrip, /isScreenFocused && CameraView/);
});

test("Drive mode never prompts automatically when a trip starts", () => {
  const drive = read("app/(tabs)/drive.tsx");
  const start = drive.indexOf("// Auto-start dashcam when a trip begins");
  const end = drive.indexOf("// Tick the trip duration", start);
  const autoStartEffect = drive.slice(start, end);

  assert.match(autoStartEffect, /refreshDashcamCameraPermission\(\)/);
  assert.doesNotMatch(autoStartEffect, /requestDashcamPermissions\(\)/);
});