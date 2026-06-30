---
name: NTSA Minor Offences fine schedule
description: Correct LN 161/2016 speeding brackets used in the fines page; 21+ km/h is a court case not a fine; 7-day resolution window
---

## Correct NTSA speeding brackets (Legal Notice 161/2016)

| Over limit | Penalty |
|---|---|
| 1–5 km/h | Official Warning — logged digitally to TIMS, no payment |
| 6–10 km/h | KES 500 instant fine |
| 11–15 km/h | KES 3,000 instant fine |
| 16–20 km/h | KES 10,000 instant fine |
| 21+ km/h | **Not a minor offence** — mandatory court appearance, risk of licence suspension and vehicle impoundment |

**Why this matters:** the original data had KES 5,000–50,000 brackets which were wrong. Always cite LN 161/2016 as the source for the 1–20 km/h brackets.

## Resolution window
**7 days** from receiving the NTSA notice to either pay or file to dispute. (The app previously said 14 days for contesting and 30 days for payment — both wrong.)

## Automated enforcement flow
1. Smart camera captures plate + speed
2. NTSA matches plate via TIMS/Aviator registry
3. SMS or email Police Notification of Traffic Offence sent to owner
4. 7-day window: admit liability & pay electronically, or dispute at Traffic Court
5. Unpaid/recurrent offences accumulate demerit points → eventual automatic suspension

## Fine interface flags
`isWarning: true` → show amber "Warning" badge (no amount)
`isCourt: true` → show purple "Court" badge + purple left border

## Data source
Fine categories: `artifacts/mobile/data/fines.ts`
