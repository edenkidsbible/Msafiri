---
name: NTSA speeding fine schedule
description: NTSA 2025 speeding brackets (supersedes LN 161/2016); 7-day resolution window; isWarning field is no longer used in any fine entry
---

## NTSA 2025 speeding brackets (current)

| Over limit | Penalty | Demerit points |
|---|---|---|
| 1–10 km/h | KES 10,000 instant fine + warning on record | 0 |
| 11–20 km/h | KES 20,000 instant fine | 3 |
| 21–30 km/h | KES 30,000 instant fine | 6 |
| 31+ km/h | KES 30,000 + mandatory court | court-determined |
| School zone (any excess) | KES 30,000 minimum + mandatory court | court-determined |
| Speeding causing accident | Court-determined + criminal | — |
| Refusing to stop at checkpoint | KES 20,000 + immediate arrest | — |

**Why:** User provided NTSA 2025 authoritative schedule images (Jul 2026). Old LN 161/2016 brackets (warning/500/3k/10k/court) are superseded. Fine amounts in the app are now dramatically higher.

## Resolution window
**7 days** from receiving the NTSA notice to either pay or dispute. Payment via KCB branches or authorized KCB agents.

## Fine interface flags
`isCourt: true` → show purple "Court" badge + purple left border  
`isWarning` field is no longer used — no current fine entry sets it. The UI gracefully handles absence (optional field).

## Data source
Fine categories: `artifacts/mobile/data/fines.ts`  
Fine UI: `artifacts/mobile/app/(tabs)/fines.tsx` and `artifacts/mobile/components/FinesContent.tsx`
