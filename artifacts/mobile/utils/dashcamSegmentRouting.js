/**
 * dashcamSegmentRouting.js
 *
 * Pure functions that encode the vehicle-scoped storage layout and the
 * mid-segment vehicle-switch routing decision for the dashcam feature.
 *
 * Kept as plain JS (no imports, no TypeScript) so the test suite can import
 * these directly with Node's native ESM loader — no bundler required.
 *
 * DashcamContext.tsx imports from this file so ANY change to these functions
 * that alters behaviour will break the corresponding unit tests immediately.
 */

// ─── Vehicle-scoped storage keys ─────────────────────────────────────────────

/**
 * AsyncStorage key for a vehicle's clip list.
 *
 * @param {string} vKey  e.g. "vehicleA", "default"
 * @returns {string}
 */
export function vehicleSegmentsKey(vKey) {
  return `dashcam_segments_${vKey}`;
}

/**
 * Filesystem directory for a vehicle's clip files.
 * The caller supplies `documentDir` (FileSystem.documentDirectory or equivalent)
 * so this function remains pure and testable without Expo.
 *
 * @param {string} vKey        vehicle key
 * @param {string} documentDir base document directory (trailing slash or empty)
 * @returns {string}           always ends with "/"
 */
export function vehicleSegmentsDir(vKey, documentDir) {
  return `${documentDir ?? ""}dashcam/segments/${vKey}/`;
}

// ─── Segment destination path ─────────────────────────────────────────────────

/**
 * Compute the final on-device URI for a segment file.
 * Uses the directory captured at SEGMENT-START time so the path is anchored
 * to the vehicle that was active when recording began, not when it finished.
 *
 * @param {string} capturedDir  directory captured by onSegmentStart()
 * @param {string} id           segment id (e.g. "seg_1700000000000")
 * @returns {string}
 */
export function computeSegmentDestUri(capturedDir, id) {
  return `${capturedDir}${id}.mp4`;
}

// ─── Vehicle-switch detection ─────────────────────────────────────────────────

/**
 * Returns true when the vehicle changed while a clip was in-flight.
 *
 * Compares the AsyncStorage key captured at segment-start time against the key
 * that is currently live. A mismatch means the driver switched vehicles between
 * onSegmentStart() and onSegmentComplete(), so the clip must be routed to the
 * original vehicle's store rather than the current one.
 *
 * @param {string} capturedAsyncKey  key captured by onSegmentStart()
 * @param {string} currentAsyncKey   current segmentsAsyncKeyRef.current
 * @returns {boolean}
 */
export function detectVehicleSwitch(capturedAsyncKey, currentAsyncKey) {
  return capturedAsyncKey !== currentAsyncKey;
}

// ─── Segment record construction ──────────────────────────────────────────────

/**
 * Build the DashcamSegment object that is persisted to AsyncStorage / React state.
 *
 * @param {{
 *   id:          string,
 *   destUri:     string,
 *   durationS:   number,
 *   sizeBytes:   number,
 *   lockReason:  string | null,
 *   coords?:     { lat: number, lng: number },
 *   nowMs?:      number,   // inject Date.now() for deterministic tests
 * }} opts
 * @returns {object}  DashcamSegment-shaped plain object
 */
export function buildDashcamSegment({ id, destUri, durationS, sizeBytes, lockReason, coords, nowMs }) {
  const now = nowMs ?? Date.now();
  return {
    id,
    uri:          destUri,
    startedAt:    now - (durationS ?? 120) * 1000,
    durationS:    durationS ?? 120,
    sizeBytes,
    locked:       !!lockReason,
    lockReason:   lockReason ?? undefined,
    uploadStatus: lockReason ? "pending" : "none",
    lat:          coords?.lat,
    lng:          coords?.lng,
  };
}
