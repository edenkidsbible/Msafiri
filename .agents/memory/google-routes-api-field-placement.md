---
name: Google Routes API v2 field placement
description: Which fields belong on Waypoint vs Location in the Routes API v2 computeRoutes body; wrong placement gives 400 INVALID_ARGUMENT.
---

# Google Routes API v2 field placement

## The rule

**`heading`** (integer, 0–359°) belongs inside the **`Location`** object, NOT at the `Waypoint` level:

```json
// CORRECT
"origin": {
  "location": {
    "latLng": { "latitude": ..., "longitude": ... },
    "heading": 90
  }
}

// WRONG — gives 400 "Unknown name heading at 'origin'"
"origin": {
  "location": { "latLng": { ... } },
  "heading": 90
}
```

**`sideOfRoad`** (boolean) belongs at the **`Waypoint`** level (same level as `location`):

```json
"destination": {
  "location": { "latLng": { ... } },
  "sideOfRoad": true
}
```

**`avoidUTurns`** does NOT exist on `routeModifiers` in Routes API v2. Valid `routeModifiers` fields are: `avoidTolls`, `avoidHighways`, `avoidFerries`, `avoidIndoor`, `vehicleInfo`, `tollPasses`. Any unrecognised field causes a hard 400 error.

## Why
Google Routes API v2 uses strict protobuf-mapped JSON. Unknown field names at any nesting level cause an immediate 400 INVALID_ARGUMENT — unlike some APIs that silently ignore unknown keys. This makes typos and wrong nesting level fail loudly in production.

## How to apply
Before adding any new field to the Routes API request body, verify the exact nesting level in the official REST reference:
`https://routes.googleapis.com/$discovery/rest?version=v2`
or the proto definition for `ComputeRoutesRequest` / `Waypoint` / `Location`.
