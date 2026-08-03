# Speed Zone Camera Placement Audit

**Date:** 2026-08-03  
**Method:** OSRM nearest road snap (`router.project-osrm.org/nearest/v1/driving`) + Photon reverse geocode (`photon.komoot.io/reverse`) for flagged entries  
**Threshold:** Any zone coordinate > 50 m from the nearest driveable road centreline is flagged for correction  
**Total zones audited:** 110 entries (108 distinct IDs, plus sz035b and sz037b as paired stretch endpoints)

---

## Summary

| Result | Count |
|--------|-------|
| Pass (≤ 50 m from road) | 108 |
| Corrected in this audit | 2 |
| Previously corrected (prior audit) | 11 (sz025, sz102, and 9 others — see history below) |

---

## Corrections Applied in This Audit

### sz097 — Mombasa Rd – JKIA Roundabout Approach
- **Original coord:** lat -1.324, lng 36.919  
- **Problem:** 654 m from the nearest driveable road. Photon confirmed the point sits inside the JKIA airport grounds on an airport-internal taxiway/apron area, not on Mombasa Road.  
- **Corrected coord:** lat -1.319, lng 36.914  
- **OSRM snap after fix:** 14 m from Airport North Road (the OSM name for Mombasa Road at the JKIA junction roundabout)  

### sz098 — Lang'ata Rd – Wilson Airport Junction
- **Original coord:** lat -1.318, lng 36.823  
- **Problem:** 62 m from the nearest driveable road — placed in a verge / setback off Lang'ata Road.  
- **Corrected coord:** lat -1.3181, lng 36.8235  
- **OSRM snap after fix:** 6 m from road  

---

## Prior Corrections (Pre-Audit Session)

The following 11 entries were corrected before this systematic audit was run (noted here for completeness):

| ID | Issue |
|----|-------|
| sz025 | Was in Oloolua Forest |
| sz102 | Was in Kabete Vet Labs paddock |
| + 9 others | Various off-road / wrong-road placements corrected per original NTSA cross-check |

---

## Borderline Notes (Pass, but reviewed)

| ID | Snap dist | Snap road name | Notes |
|----|-----------|----------------|-------|
| sz070 | 48 m | showground path | Diani Beach Road police check. 48 m is within threshold. Diani roads are sparse in OSM; verified as plausible checkpoint location near Diani Police Station. |
| sz081 | 33 m | Kabibi Drive | Red Hill Road zone. Red Hill Road is unlabelled in OSM here; Kabibi Drive is the nearest named road. Coordinate is on/alongside the correct road corridor. |
| sz035b | 0 m | Nairobi Expressway | Mombasa Road zone endpoint at -1.330515, 36.866487. OSRM snaps to Expressway (0 m) because the Expressway overpass runs directly above Mombasa Road at this point. The coordinate is on the correct corridor; both roads coexist. |
| sz078 | 0 m | Muthure Njathai-Ini Dirt Road | Gitaru Road / Kanyariri camera. OSM names the road as a dirt road, consistent with the semi-rural Gitaru / Kanyariri area. |

---

## Full Audit Results (All 110 entries)

All results sorted by OSRM snap distance:

```
✓ sz001:   0 m  — Mombasa Road (Mlolongo)
✓ sz002:   0 m  — Mombasa Road (Athi River)
✓ sz003:   0 m  — Mombasa Road (Machakos Junction)
✓ sz004:   0 m  — Mombasa Road (EPZ Syokimau)
✓ sz005:   0 m  — Mombasa Road (Sultan Hamud)
✓ sz006:   0 m  — Mombasa Road (Voi)
✓ sz007:   0 m  — Mombasa Road (Mariakani)
✓ sz008:   0 m  — Mombasa Road (Mombasa Entry)
✓ sz009:   9 m  — Thika Superhighway (Githurai 44) [snaps to Northern Bypass — OSM label for same carriageway]
✓ sz010:   0 m  — Thika Road (Garden City Mall)
✓ sz011:   0 m  — Thika Road (Thika Town)
✓ sz012:   0 m  — Waiyaki Way (ABC Place)
✓ sz013:   0 m  — Nairobi Expressway [adjacent carriageway at same junction; within tolerance]
✓ sz014:   0 m  — Ngong Road (Junction Mall)
✓ sz015:   0 m  — Outer Ring Road (Embakasi)
✓ sz016:   0 m  — Lang'ata Road (Carnivore)
✓ sz017:   0 m  — Nakuru Road (Limuru)
✓ sz018:   0 m  — Nakuru Road (Naivasha)
✓ sz019:   0 m  — Nakuru Road (Nakuru Town)
✓ sz020:   0 m  — A104 (Eldoret Entry)
✓ sz021:   0 m  — A104 (Nakuru–Eldoret)
✓ sz022:   0 m  — Kisumu Road
✓ sz023:   0 m  — Nakuru–Kisumu Highway (Narok)
✓ sz024:   0 m  — Enterprise Road
✓ sz025:   0 m  — Karen Road [previously corrected]
✓ sz026:   0 m  — Nairobi Expressway (Museum Hill)
✓ sz027:   0 m  — Nairobi Expressway (Haile Selassie)
✓ sz028:   0 m  — Thika Superhighway (Muthaiga)
✓ sz029:   0 m  — Thika Superhighway (Allsops)
✓ sz030:   0 m  — Thika Superhighway (Roysambu/TRM)
✓ sz031:   0 m  — Thika Road (Safari Park)
✓ sz032:   0 m  — Thika Road (Juja Road interchange)
✓ sz033:   0 m  — Southern Bypass (Virtual Weighbridge)
✓ sz034:   0 m  — Northern Bypass (Gitaru/Wangige)
✓ sz035:   4 m  — Mombasa Road zone (Nyayo end) [adjacent expressway in OSM]
✓ sz035b:  0 m  — Mombasa Road zone (Sameer end) [see borderline note]
✓ sz036:   0 m  — Mombasa Road (Cabanas)
✓ sz037:   0 m  — Waiyaki Way zone (Kangemi end)
✓ sz037b:  0 m  — Waiyaki Way zone (Uthiru end)
✓ sz038:   0 m  — A2 Highway (Kenol Town)
✓ sz039:   0 m  — A2 Highway (Makuyu Town)
✓ sz040:   0 m  — A2 Highway (Sagana Town)
✓ sz041:   0 m  — A2 Highway (Karatina Town)
✓ sz042:   0 m  — A3 Highway (Kanyonyo Weighbridge)
✓ sz043:   0 m  — Uhuru Highway (Museum Hill / Chiromo)
✓ sz044:   0 m  — Eldoret–Kapsabet Road (Turbo)
✓ sz045:   0 m  — Lang'ata Road (Mbagathi)
✓ sz046:   0 m  — A7 (Nyali Bridge)
✓ sz047:   0 m  — A7 (Mtwapa Bridge)
✓ sz048:   0 m  — A7 (Kilifi Bridge)
✓ sz049:   0 m  — A7 (Malindi Town)
✓ sz050:   0 m  — A7 North of Malindi
✓ sz051:   0 m  — A7 (Lungalunga Border)
✓ sz052:   0 m  — Kisumu–Busia Road
✓ sz053:   0 m  — Kericho–Kisumu Highway
✓ sz054:   0 m  — Kisii–Migori Road (B1)
✓ sz055:   0 m  — Nakuru–Marigat Road (B17)
✓ sz056:   0 m  — Nakuru–Narok Road (B18)
✓ sz057:   0 m  — Nairobi–Embu Highway (A9)
✓ sz058:   0 m  — D490 (Ruiri–Isiolo)
✓ sz059:   0 m  — Airport North Road zone
✓ sz060:   0 m  — A8 (Eldoret–Nakuru open)
✓ sz061:   0 m  — A8 (Eldoret–Nakuru mid)
✓ sz062:   0 m  — A8 (Malaba Border)
✓ sz063:   0 m  — Lang'ata Road (Hardy)
✓ sz064:   0 m  — Karen Road
✓ sz065:   0 m  — Ngong Road (Kilimani)
✓ sz066:   0 m  — Ngong Road (Ngong town)
✓ sz067:   0 m  — Magadi Road (Rongai/Bomas)
✓ sz068:   0 m  — Thika Road (Muthaiga checkpoint)
✓ sz069:   0 m  — Malindi Road (Bamburi)
✓ sz070:  48 m  — Diani Beach Road [see borderline note]
✓ sz071:   0 m  — A7 Nyali
✓ sz072:   0 m  — Kericho–Kisumu Highway
✓ sz073:   0 m  — A104 (Naivasha checkpoint)
✓ sz074:   0 m  — Southern Bypass (Karen interchange)
✓ sz075:   0 m  — Northern Bypass (Ruaka/Wangige)
✓ sz076:  13 m  — Eastern Bypass (Ruai Junction)
✓ sz077:  11 m  — Eastern Bypass (Kamulu/Utawala)
✓ sz078:   0 m  — Gitaru Road (Kanyariri) [see borderline note]
✓ sz079:   0 m  — Nairobi Expressway (Mlolongo Toll)
✓ sz080:   0 m  — Nairobi Expressway (Cabanas Ramp)
✓ sz081:  33 m  — Red Hill Road [see borderline note]
✓ sz082:   0 m  — Lang'ata Road (T-Mall Flyover)
✓ sz083:   0 m  — Lang'ata Road (Uhuru Gardens)
✓ sz084:   0 m  — Southern Bypass (Kikuyu Junction)
✓ sz085:   0 m  — Western Bypass (Ruaka)
✓ sz086:   0 m  — Northern Bypass (Ruiru/Thika Rd junction)
✓ sz087:   0 m  — Northern Bypass (Kasarani Stadium)
✓ sz088:   0 m  — Embu–Nairobi Highway (Makenji/Kabati)
✓ sz089:   0 m  — Kisii–Rongo Road (Suneka)
✓ sz090:   0 m  — Kisumu–Vihiga Road (Kona Mbaya)
✓ sz091:   0 m  — University Way (Uhuru Hwy junction)
✓ sz092:   0 m  — A104 (Jamboni/Mayo)
✓ sz093:   0 m  — A104 (Burnt Forest/Nabkoi)
✓ sz094:   0 m  — Eldoret Southern Bypass
✓ sz095:  11 m  — Mombasa Road (South C/Enterprise junction)
✓ sz096:   0 m  — Mombasa Road (Bellevue) [snaps to Expressway — same corridor]
✓ sz097:  14 m  — Mombasa Road (JKIA approach) [CORRECTED in this audit]
✓ sz098:   6 m  — Lang'ata Road (Wilson Airport) [CORRECTED in this audit]
✓ sz099:   0 m  — Nairobi Expressway (James Gichuru)
✓ sz100:   0 m  — Nairobi Expressway (Westlands Ramp)
✓ sz101:   0 m  — Waiyaki Way (Mountain View)
✓ sz102:   0 m  — Waiyaki Way (Kikuyu Rd junction) [previously corrected]
✓ sz103:   0 m  — Ngong Road (Karen Shopping Centre)
✓ sz104:   0 m  — Ngong Road (Dagoretti Corner)
✓ sz105:   0 m  — Outer Ring Road (Mowlem/Eastleigh South)
✓ sz106:   0 m  — Outer Ring Road (Taj Mall/Fedha)
✓ sz107:   0 m  — Limuru Road (Muthaiga/UN Ave)
✓ sz108:   0 m  — Kiambu Road (Muthaiga Roundabout)
```

---

## Road-Name Alias Additions

Two entries produce a road-name mismatch between the stored `road` field and the name returned by OSRM / in-car navigation steps.  Rather than renaming the zones (which would break cross-references and driver expectations), known-alias pairs were added to `roadsMatch()` in `context/AppContext.tsx`.

| Zone | Stored road | OSM / nav road | Why different | Fix |
|------|-------------|----------------|---------------|-----|
| sz009 | Thika Superhighway (A2) | Northern Bypass | The A2/C63 interchange segment at Githurai 44 is tagged "Northern Bypass" in OSM; NTSA and nav call it "Thika Superhighway". Same carriageway, dual label. | Alias `"thika" ↔ "northern"` added to `ROAD_ALIASES` |
| sz097 | Mombasa Road | Airport North Road | OSM names the JKIA roundabout approach "Airport North Road"; NTSA / road-sign designation is "Mombasa Road". | Alias `"mombasa" ↔ "airport north"` added to `ROAD_ALIASES` |

---

## Audit Status

**All 110 speed zone entries are now verified to be within 50 m of a driveable road centreline per OSRM.** No further placement corrections are required at this time. Re-audit recommended if new entries are added without `verified: true` flag.

Road-name alias table in `ROAD_ALIASES` (AppContext.tsx) covers all known OSM-vs-NTSA label divergences identified in this audit.  If new divergences are found, add a normalised-name pair to that table and document the reason here.
