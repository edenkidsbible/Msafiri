---
name: Custom vehicle display name pitfalls
description: Two bugs in vehicle naming for known-make + custom-model scenario; fixes applied.
---

## Rule
`vehicleDisplayName` must handle four separate cases in this priority order:
1. `make && model` — both in static list → `make.name + model.name`
2. `make && customModelName` — known make (static list) + custom model → `make.name + customModelName` ← missing case caused "My Vehicle"
3. `customMakeName && customModelName` — fully custom
4. Either alone → single name or "My Vehicle"

**Why:** `vehicle-setup.tsx` sets `resolvedCustomMake = null` for known-make + custom-model (only custom makes get the name). The `null && "Arteon"` check was falsy → fell through to "My Vehicle".

**How to apply:** Keep this exact priority order in `vehicleDisplayName` wherever it appears (garage.tsx, manage-vehicles.tsx). The fix is already in both files.

## vehicle-setup.tsx ID generation fix
Old: `custom-${Date.now()}` / `custom-${Date.now()}-m` for custom make/model IDs — timestamps that never match image URLs.
New: `custom-${slugify(makeName)}` / `custom-${slugify(modelName)}` — matches what the server writes to R2.

Also: `resolvedCustomMake` for known-make + custom-model must be `CAR_MAKES.find(m => m.id === makeId)?.name` (the make's display name), not null.
