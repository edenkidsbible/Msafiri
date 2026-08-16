---
name: PostgreSQL TIMESTAMP timezone trap
description: TIMESTAMP WITHOUT TIME ZONE columns return strings without 'Z'; Hermes on React Native parses them as local time, showing 3h early in EAT.
---

## The rule
Every `TIMESTAMP WITHOUT TIME ZONE` column returned from PostgreSQL via the `pg` driver comes back as a plain string like `"2024-08-16 07:30:00.000"` — no `Z`, space separator. Hermes (React Native JS engine) parses this as *local* time. On an EAT device (UTC+3) the timestamp is treated as 07:30 EAT instead of 07:30 UTC, showing 3 hours *early*.

**Why:** The `live_trips` table uses `TIMESTAMP` (no timezone). All other timestamp columns in the schema have the same type. The pg driver does not coerce them to `Date` objects when returned via `db.execute(sql\`...\`)`.

**How to apply:**
- In `artifacts/api-server/src/routes/liveTrips.ts` a `toUtcIso(ts: unknown): string | null` helper normalises every timestamp before it leaves the API:
  ```ts
  function toUtcIso(ts: unknown): string | null {
    if (!ts) return null;
    if (ts instanceof Date) return ts.toISOString();
    const s = String(ts).trim().replace(" ", "T");
    return s.endsWith("Z") ? s : s + "Z";
  }
  ```
- Apply the same pattern to ANY new endpoint that reads `TIMESTAMP WITHOUT TIME ZONE` columns.
- On the mobile side, never use `date-fns` `format()` — it ignores timezone. Use `toLocaleDateString` / `toLocaleTimeString` with `timeZone: "Africa/Nairobi"` instead, or the EAT helper functions added to crash-assistant, accident-reports, dashcam-videos.
- `isToday` / `isYesterday` from date-fns also use local device time — replace with `eatKey()` comparison (format date in EAT then compare strings).
