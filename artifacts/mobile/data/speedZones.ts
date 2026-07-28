export type ZoneType = "camera" | "police" | "zone";

export interface SpeedZone {
  id: string;
  verified?: boolean;        // admin has physically confirmed this location
  name: string;
  road: string;
  lat: number;
  lng: number;
  speedLimit: number;
  type: ZoneType;
  description: string;
  /** True for the two flattened endpoint markers derived from an admin
   *  "road stretch" zone (see apiZoneToStaticZones in AppContext.tsx). These
   *  exist only for map display / proximity alerts; they must NOT be used to
   *  determine the driver's confident current speed limit — that's decided
   *  by the tighter corridor projection against the full stretch segment
   *  (see projectOntoSegment / stretchMatch), since a point-radius match at
   *  an endpoint can't tell whether the driver is actually on that road. */
  isStretchEndpoint?: boolean;
}

export const SPEED_ZONES: SpeedZone[] = [
  // ── Mombasa Road (A109) ──────────────────────────────────────────────────────
  // Source: NTSA 2025 — 80 km/h urban sections (Nairobi to Athi River bypass);
  // 100 km/h open highway beyond Athi River bypass junction.
  { id: "sz001", name: "Mlolongo Speed Camera", road: "Mombasa Road", lat: -1.394615, lng: 36.942946, speedLimit: 80, type: "camera", description: "Fixed ANPR camera. Urban section limit: 80 km/h" },
  { id: "sz002", name: "Athi River Camera", road: "Mombasa Road", lat: -1.437847, lng: 36.976742, speedLimit: 80, type: "camera", description: "Fixed camera at Athi River bypass junction. 100 km/h resumes toward Mombasa from here. Enforced at 80 km/h." },
  { id: "sz003", name: "Machakos Junction Police", road: "Mombasa Road", lat: -1.484211, lng: 37.019028, speedLimit: 80, type: "police", description: "Frequent radar checks. Limit: 80 km/h" },
  { id: "sz004", name: "EPZ Syokimau Camera", road: "Mombasa Road", lat: -1.378727, lng: 36.927571, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at EPZ (Export Processing Zone) junction. Limit: 80 km/h" },
  { id: "sz005", name: "Sultan Hamud Camera", road: "Mombasa Road", lat: -2.01618, lng: 37.373908, speedLimit: 50, type: "camera", description: "Town camera. Limit: 50 km/h" },
  { id: "sz006", name: "Voi Speed Camera", road: "Mombasa Road", lat: -3.398682, lng: 38.553475, speedLimit: 50, type: "camera", description: "Voi town camera. Limit: 50 km/h" },
  { id: "sz007", name: "Mariakani Police Check", road: "Mombasa Road", lat: -3.860859, lng: 39.460982, speedLimit: 80, type: "police", description: "Regular radar checks at Mariakani" },
  { id: "sz008", name: "Mombasa Entry Camera", road: "Mombasa Road", lat: -4.043498, lng: 39.668191, speedLimit: 50, type: "camera", description: "City entry camera. Limit: 50 km/h" },

  // ── Thika Superhighway (A2) ──────────────────────────────────────────────────
  // Source: NTSA 2025 — 100 km/h open sections; 80 km/h near all interchanges.
  { id: "sz009", name: "Thika Road – Githurai 44 Flyover", road: "Thika Superhighway (A2)", lat: -1.195481, lng: 36.902841, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Githurai 44 flyover underpass. Limit: 80 km/h" },
  { id: "sz010", name: "Thika Road – Garden City Mall", road: "Thika Superhighway (A2)", lat: -1.230489, lng: 36.878292, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Garden City Mall section. High enforcement. Limit: 80 km/h" },
  { id: "sz011", name: "Thika Town Speed Zone", road: "Thika Superhighway (A2)", lat: -1.039607, lng: 37.087016, speedLimit: 50, type: "zone", description: "Town limit: 50 km/h" },

  // ── Waiyaki Way ──────────────────────────────────────────────────────────────
  // Source: NTSA 2025 — 80 km/h; fixed gantry at ABC Place, fixed poles along route.
  { id: "sz012", name: "Waiyaki Way – ABC Place / Westlands Interchange", road: "Waiyaki Way", lat: -1.262, lng: 36.781, speedLimit: 80, type: "camera", description: "Fixed gantry camera at ABC Place / Westlands Interchange. Limit: 80 km/h" },
  { id: "sz013", name: "Waiyaki Way – ABC Place Police", road: "Waiyaki Way", lat: -1.259027, lng: 36.776993, speedLimit: 80, type: "police", description: "Radar checkpoint near ABC Place. Limit: 80 km/h" },

  // ── Ngong Road ───────────────────────────────────────────────────────────────
  // Source: NTSA 2025 — 50 km/h at Junction Mall / Adams Arcade; 60 km/h Dagoretti Corner.
  { id: "sz014", name: "Ngong Road – Junction Mall / Adams Arcade", road: "Ngong Road", lat: -1.300001, lng: 36.769948, speedLimit: 50, type: "camera", description: "Fixed ANPR camera at Junction Mall / Adams Arcade area. Limit: 50 km/h" },

  // ── Outer Ring Road ──────────────────────────────────────────────────────────
  // Source: NTSA 2025 — 60 km/h (urban dual carriageway).
  { id: "sz015", name: "Outer Ring Road – Embakasi Camera", road: "Outer Ring Road", lat: -1.295123, lng: 36.880008, speedLimit: 60, type: "camera", description: "Fixed camera near Embakasi on Outer Ring Road. Limit: 60 km/h" },

  // ── Lang'ata Road ─────────────────────────────────────────────────────────────
  // Source: NTSA 2025 — 60 km/h (urban arterial).
  { id: "sz016", name: "Lang'ata Road – Carnivore Section Camera", road: "Lang'ata Road", lat: -1.328005, lng: 36.800318, speedLimit: 60, type: "camera", description: "Fixed camera at Carnivore Restaurant section on Lang'ata Road. Limit: 60 km/h" },

  // ── Nakuru Road (A104) ────────────────────────────────────────────────────────
  { id: "sz017", name: "Limuru Police Radar", road: "Nakuru Road", lat: -1.116812, lng: 36.632839, speedLimit: 50, type: "police", description: "Radar on steep descent into Limuru. Limit: 50 km/h" },
  { id: "sz018", name: "Naivasha Speed Camera", road: "Nakuru Road", lat: -0.716737, lng: 36.431032, speedLimit: 50, type: "camera", description: "Town camera. Limit: 50 km/h" },
  { id: "sz019", name: "Nakuru Town Entry Camera", road: "Nakuru Road", lat: -0.303109, lng: 36.079983, speedLimit: 50, type: "camera", description: "Entry camera. Limit: 50 km/h" },

  // ── Eldoret / A104 north ──────────────────────────────────────────────────────
  { id: "sz020", name: "Eldoret Entry Camera", road: "A104 (Nakuru–Eldoret)", lat: 0.51424, lng: 35.269842, speedLimit: 50, type: "camera", description: "Eldoret town entry. Limit: 50 km/h" },
  { id: "sz021", name: "Nakuru–Eldoret Police Check", road: "A104 Highway", lat: 0.16344, lng: 35.621731, speedLimit: 100, type: "police", description: "Regular radar on highway. Limit: 100 km/h" },

  // ── Kisumu ────────────────────────────────────────────────────────────────────
  { id: "sz022", name: "Kisumu City Camera", road: "Kisumu Road", lat: -0.102181, lng: 34.761723, speedLimit: 50, type: "camera", description: "City centre camera. Limit: 50 km/h" },
  { id: "sz023", name: "Narok Police Check", road: "Nakuru–Kisumu Highway", lat: -1.083439, lng: 35.866892, speedLimit: 80, type: "police", description: "Police radar on Kisumu highway" },

  // ── Nairobi CBD / Enterprise ──────────────────────────────────────────────────
  { id: "sz024", name: "Enterprise Road Camera", road: "Enterprise Road", lat: -1.311087, lng: 36.848991, speedLimit: 50, type: "camera", description: "Industrial area camera. Limit: 50 km/h" },
  { id: "sz025", name: "Karen Residential Zone", road: "Karen Road", lat: -1.36014, lng: 36.709936, speedLimit: 50, type: "zone", description: "Residential area. Limit: 50 km/h" },

  // ── Nairobi Expressway (M27) ──────────────────────────────────────────────────
  // Source: NTSA 2025 — 110 km/h open sections; 80 km/h near toll plazas, ramps &
  // interchanges; 60 km/h at Mlolongo Toll Plaza entry/exit zone.
  { id: "sz026", name: "Expressway – Museum Hill Interchange Camera", road: "Nairobi Expressway", lat: -1.273085, lng: 36.81417, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Museum Hill Interchange on the Expressway. Limit: 80 km/h" },
  { id: "sz027", name: "Expressway – Haile Selassie / Nyayo Interchange", road: "Nairobi Expressway", lat: -1.294404, lng: 36.821852, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Haile Selassie / Nyayo interchange on the Expressway. Limit: 80 km/h" },

  // ── Thika Superhighway (A2) – additional corridor cameras ────────────────────
  { id: "sz028", name: "Thika Road – Muthaiga Interchange Camera", road: "Thika Superhighway (A2)", lat: -1.265981, lng: 36.838013, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on overhead gantry at Muthaiga interchange. Limit: 80 km/h" },
  { id: "sz029", name: "Thika Road – Allsops / Moi Air Base (Kasarani end)", road: "Thika Superhighway (A2)", lat: -1.244835, lng: 36.864646, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Allsops / GSU HQ, Moi Air Base flyover (Kasarani end). Limit: 80 km/h" },
  { id: "sz030", name: "Thika Road – Roysambu / TRM Mall", road: "Thika Superhighway (A2)", lat: -1.219719, lng: 36.890067, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Roysambu / TRM Mall section. Frequently reported on Waze. Limit: 80 km/h" },
  { id: "sz031", name: "Thika Road – Safari Park / Open Section", road: "Thika Superhighway (A2)", lat: -1.226279, lng: 36.883986, speedLimit: 100, type: "camera", description: "Open highway section near Safari Park. Speed: 100 km/h" },
  { id: "sz032", name: "Thika Road – Juja Road Interchange", road: "Thika Superhighway (A2)", lat: -1.134501, lng: 36.972304, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Juja Road interchange — cameras on approach from both directions. Limit: 80 km/h" },

  // ── Southern & Northern Bypass ────────────────────────────────────────────────
  // Source: NTSA 2025 — 80 km/h; Kikuyu junction open section 100 km/h.
  { id: "sz033", name: "Southern Bypass – Virtual Weighbridge", road: "Southern Bypass", lat: -1.318828, lng: 36.723157, speedLimit: 80, type: "camera", description: "Virtual weighbridge enforcement point on Southern Bypass. Limit: 80 km/h" },
  { id: "sz034", name: "Northern Bypass – Gitaru / Wangige", road: "Northern Bypass", lat: -1.216809, lng: 36.751062, speedLimit: 80, type: "camera", description: "Mobile enforcement point after Gitaru near Wangige on Northern Bypass. Limit: 80 km/h" },

  // ── Mombasa Road (A109) – speed zone corridor & Nairobi urban cameras ─────────
  { id: "sz035",  name: "Mombasa Rd Zone – Nyayo Stadium end",         road: "Mombasa Road", lat: -1.305506,   lng: 36.826756, speedLimit: 80, type: "zone", description: "Speed zone: Nyayo Stadium → Sameer Business Park. Approaching from Nairobi CBD side. Limit: 80 km/h" },
  { id: "sz035b", name: "Mombasa Rd Zone – Sameer Business Park end",  road: "Mombasa Road", lat: -1.330515,  lng: 36.866487, speedLimit: 80, type: "zone", description: "Speed zone: Nyayo Stadium → Sameer Business Park. Approaching from Mlolongo/JKIA side. Limit: 80 km/h" },
  { id: "sz036",  name: "Mombasa Road – Cabanas / Airtel Interchange", road: "Mombasa Road", lat: -1.335741,   lng: 36.893077, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Cabanas / Cabanas Shopping Centre stretch. Limit: 80 km/h" },

  // ── Waiyaki Way – zone ────────────────────────────────────────────────────────
  { id: "sz037",  name: "Waiyaki Way Zone – Kangemi end", road: "Waiyaki Way", lat: -1.266409, lng: 36.744651, speedLimit: 60, type: "zone", description: "Built-up area zone: Kangemi → Uthiru. Approaching from Nairobi/Westlands side. Limit: 60 km/h" },
  { id: "sz037b", name: "Waiyaki Way Zone – Uthiru end",  road: "Waiyaki Way", lat: -1.258105, lng: 36.71359,  speedLimit: 60, type: "zone", description: "Built-up area zone: Kangemi → Uthiru. Approaching from Kikuyu/Dagoretti side. Limit: 60 km/h" },

  // ── A2 Highway – Nairobi–Nyeri corridor town zones ────────────────────────────
  { id: "sz038", name: "Kenol Town Speed Zone",    road: "A2 Highway (Nairobi–Nyeri)", lat: -0.913454, lng: 37.070282, speedLimit: 50, type: "zone", description: "Built-up area limit through Kenol town. Limit: 50 km/h" },
  { id: "sz039", name: "Makuyu Town Speed Zone",   road: "A2 Highway (Nairobi–Nyeri)", lat: -0.88025,  lng: 37.098908, speedLimit: 50, type: "zone", description: "Built-up area limit through Makuyu town. Limit: 50 km/h" },
  { id: "sz040", name: "Sagana Town Speed Zone",   road: "A2 Highway (Nairobi–Nyeri)", lat: -0.669471, lng: 37.206091,  speedLimit: 50, type: "zone", description: "Built-up area limit through Sagana town. Limit: 50 km/h" },
  { id: "sz041", name: "Karatina Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.480649, lng: 37.124737, speedLimit: 50, type: "zone", description: "Built-up area limit through Karatina town. Limit: 50 km/h" },
  { id: "sz042", name: "Kanyonyo Weighbridge – Speed Camera", road: "Thika–Garissa Road (A3)", lat: -1.098222, lng: 37.668968, speedLimit: 50, type: "camera", description: "KeNHA static weighbridge at Kanyonyo on the A3, near the Machakos/Kitui border. Limit: 50 km/h" },

  // ── CBD corridors ─────────────────────────────────────────────────────────────
  // Source: NTSA 2025 — Uhuru Highway 60 km/h (urban arterial); Chiromo Rd 60 km/h.
  { id: "sz043", name: "Uhuru Highway – Haile Selassie / Museum Hill Camera", road: "Chiromo Road (A8)", lat: -1.289792, lng: 36.818817, speedLimit: 60, type: "camera", description: "Fixed camera at Museum Hill / Chiromo junction. Uhuru Highway / Haile Selassie Avenue approach. Limit: 60 km/h" },
  { id: "sz044", name: "Kapsabet / Turbo Camera", road: "Eldoret–Kapsabet Road", lat: 0.199944, lng: 35.100815, speedLimit: 80, type: "camera", description: "Fixed camera near Kapsabet / Turbo junction, west of Eldoret. Limit: 80 km/h" },
  // Source: NTSA 2025 — Lang'ata Road 60 km/h (urban arterial).
  { id: "sz045", name: "Mbagathi / Lang'ata Camera", road: "Lang'ata Road", lat: -1.312601, lng: 36.81604, speedLimit: 60, type: "camera", description: "Fixed camera on Lang'ata Road near Mbagathi. Limit: 60 km/h" },

  // ── A7 Coastal Corridor – Mombasa to Malindi & beyond ────────────────────────
  { id: "sz046", name: "Nyali Bridge Speed Zone",     road: "A7 (Mombasa–Malindi)", lat: -4.042851, lng: 39.672391, speedLimit: 50, type: "zone", description: "Controlled zone on Nyali Bridge – Mombasa approach. Limit: 50 km/h" },
  { id: "sz047", name: "Mtwapa Bridge Speed Zone",    road: "A7 (Mombasa–Malindi)", lat: -3.955394, lng: 39.741492, speedLimit: 50, type: "zone", description: "50 km/h zone at Mtwapa Bridge, north of Mombasa. Limit: 50 km/h" },
  { id: "sz048", name: "Kilifi Bridge Speed Zone",    road: "A7 (Mombasa–Malindi)", lat: -3.636207, lng: 39.848478, speedLimit: 50, type: "zone", description: "50 km/h zone at Kilifi Bridge. Limit: 50 km/h" },
  { id: "sz049", name: "Malindi Town Speed Zone",     road: "A7 (Mombasa–Malindi)", lat: -3.217514, lng: 40.119106, speedLimit: 50, type: "zone", description: "50 km/h built-up zone through Malindi town. Limit: 50 km/h" },
  { id: "sz050", name: "Malindi Open Road Zone",      road: "A7 North of Malindi",   lat: -3.113251, lng: 40.157361, speedLimit: 80, type: "zone", description: "Open highway section north of Malindi towards Lamu. Limit: 80 km/h" },
  { id: "sz051", name: "Lungalunga Border Zone",      road: "A7 Lungalunga–Ramisi",  lat: -4.537808, lng: 39.161664, speedLimit: 50, type: "zone", description: "Speed-controlled zone at Lungalunga border post. Limit: 50 km/h" },

  // ── Western Kenya corridors ───────────────────────────────────────────────────
  { id: "sz052", name: "A12 Kisumu–Busia Highway",    road: "Kisumu–Busia Road",   lat:  0.21459,  lng: 34.261288, speedLimit: 80,  type: "zone", description: "80 km/h trunk highway — Kisumu to Busia corridor." },
  { id: "sz053", name: "A12 Kericho–Kisumu Highway",  road: "Kisumu–Busia Road", lat: -0.264256, lng: 35.461105, speedLimit: 80,  type: "zone", description: "80 km/h trunk road — Kericho to Kisumu. Regular radar checks." },
  { id: "sz054", name: "B1 Migori Highway Zone",      road: "Kisii–Migori Road",    lat: -1.066695, lng: 34.466975, speedLimit: 100, type: "zone", description: "100 km/h trunk section on B1 near Migori. Limit: 100 km/h" },
  { id: "sz055", name: "B17 Nakuru–Marigat Highway",  road: "Nakuru–Marigat Road", lat: -0.012587, lng: 35.964274, speedLimit: 100, type: "zone", description: "100 km/h primary road — Nakuru to Marigat. Limit: 100 km/h" },
  { id: "sz056", name: "B18 Narok–Mau Narok–Njoro Zone", road: "Nakuru–Narok Road", lat: -0.772617, lng: 35.895688, speedLimit: 80, type: "zone", description: "80 km/h trunk road — Narok to Mau Narok to Njoro. Limit: 80 km/h" },

  // ── Eastern Kenya / Mt Kenya region ──────────────────────────────────────────
  { id: "sz057", name: "A9 Embu–Siakago Highway",  road: "Nairobi–Embu Highway",  lat: -0.558203, lng: 37.546487, speedLimit: 80,  type: "zone", description: "80 km/h trunk road — Embu to Siakago. Limit: 80 km/h" },
  { id: "sz058", name: "D490 Ruiri–Isiolo Road",   road: "D490 (Ruiri–Isiolo)", lat:  0.234868, lng: 37.612488, speedLimit: 110, type: "zone", description: "Open semi-arid road — Ruiri to Isiolo. Drive to conditions. Limit: 110 km/h" },
  { id: "sz059", name: "Airport North Road Zone",  road: "Airport North Road",  lat: -1.317996, lng: 36.921416, speedLimit: 50,  type: "zone", description: "50 km/h zone on Airport North Road near JKIA." },

  // ── A8 Eldoret corridor ───────────────────────────────────────────────────────
  { id: "sz060", name: "A8 Eldoret–Nakuru Open Highway",  road: "A8 (Eldoret–Nakuru)", lat:  0.451985, lng: 35.30695,  speedLimit: 110, type: "zone", description: "110 km/h open highway — Eldoret to Nakuru. Limit: 110 km/h" },
  { id: "sz061", name: "A8 Eldoret–Nakuru Mid-Section",   road: "A8 (Eldoret–Nakuru)", lat:  0.243186, lng: 35.416645, speedLimit: 80,  type: "zone", description: "80 km/h section — built-up mid-route between Eldoret and Nakuru. Limit: 80 km/h" },
  { id: "sz062", name: "A8 Malaba Border – Open Highway", road: "A8 (Eldoret–Malaba)", lat:  0.632723, lng: 34.271231, speedLimit: 110, type: "zone", description: "110 km/h trunk — Eldoret to Malaba border. Limit: 110 km/h" },

  // ── Police checkpoint zones ───────────────────────────────────────────────────
  // Source: NTSA 2025 — Lang'ata Road 60 km/h; Ngong Road 60 km/h arterial.
  { id: "sz063", name: "Langata Police – Hardy / Lang'ata Road Post", road: "Lang'ata Road", lat: -1.33199, lng: 36.781995, speedLimit: 60, type: "police", description: "Hardy / Lang'ata Road Police Post — frequent mobile radar. Limit: 60 km/h" },
  { id: "sz064", name: "Karen Police Checkpoint Zone", road: "Karen Road / Ngong Road", lat: -1.321809, lng: 36.706077, speedLimit: 50, type: "police", description: "Karen Police Station — residential speed checks. Limit: 50 km/h" },
  { id: "sz065", name: "Kilimani Police Checkpoint – Ngong Road", road: "Ngong Road", lat: -1.291798, lng: 36.79511, speedLimit: 60, type: "police", description: "Kilimani Divisional Police — radar on Ngong Road near Police Line. Limit: 60 km/h" },
  { id: "sz066", name: "Ngong Police Checkpoint", road: "Ngong Road", lat: -1.365336, lng: 36.653725, speedLimit: 50, type: "police", description: "Ngong Police Station — checkpoint at Ngong town entry. Limit: 50 km/h" },
  { id: "sz067", name: "Rongai / Bomas Police Check", road: "Magadi Road / Bomas", lat: -1.397245, lng: 36.756893, speedLimit: 50, type: "police", description: "Rongai Police — frequent checkpoint near Bomas of Kenya junction. Limit: 50 km/h" },
  { id: "sz068", name: "Muthaiga Police Checkpoint", road: "Thika Superhighway (A2)", lat: -1.2603, lng: 36.842997, speedLimit: 80, type: "police", description: "Muthaiga Police Station — radar stops near Thika Road Muthaiga junction. Limit: 80 km/h" },
  { id: "sz069", name: "Bamburi Police Checkpoint (Mombasa)", road: "A7 Malindi Road", lat: -3.999696, lng: 39.728051, speedLimit: 80, type: "police", description: "Bamburi Police — radar on Malindi Road north of Mombasa. Limit: 80 km/h" },
  { id: "sz070", name: "Diani Police Checkpoint (South Coast)", road: "Diani Beach Road", lat: -4.284414, lng: 39.570030, speedLimit: 50, type: "police", description: "Diani Police Station — checkpoint on South Coast road. Limit: 50 km/h" },
  { id: "sz071", name: "Nyali Police Checkpoint (Mombasa)", road: "A7 Nyali", lat: -4.052709, lng: 39.693324, speedLimit: 50, type: "police", description: "Nyali Police Station — speed checks near Nyali Bridge. Limit: 50 km/h" },
  { id: "sz072", name: "Kericho Police Checkpoint", road: "Kericho Town", lat: -0.367833, lng: 35.287581, speedLimit: 50, type: "police", description: "Kericho Police Station — checkpoint at town entry on A12. Limit: 50 km/h" },
  { id: "sz073", name: "Naivasha Police Checkpoint", road: "A104 (Nakuru Road)", lat: -0.767026, lng: 36.447915, speedLimit: 50, type: "police", description: "Police post near Naivasha on Nakuru Road — regular speed checks. Limit: 50 km/h" },

  // ── Southern & Northern Bypass – additional (NTSA 2025) ──────────────────────
  { id: "sz074", name: "Southern Bypass – Karen / Ngong Road Interchange", road: "Southern Bypass", lat: -1.3215, lng: 36.7664, speedLimit: 80, type: "camera", description: "Fixed camera at Karen / Ngong Road interchange on Southern Bypass. Limit: 80 km/h" },
  { id: "sz075", name: "Northern Bypass – Ruaka / Wangige Stretch", road: "Northern Bypass", lat: -1.203869, lng: 36.780508, speedLimit: 80, type: "camera", description: "Fixed camera near Ruaka on Northern Bypass approach to Wangige. Limit: 80 km/h" },

  // ── Eastern Bypass (A104) ─────────────────────────────────────────────────────
  // Source: NTSA 2025 — fixed cameras at Ruai junction and Kamulu interchange, 80 km/h.
  { id: "sz076", name: "Eastern Bypass – Ruai Junction Camera", road: "Eastern Bypass", lat: -1.272, lng: 36.9758, speedLimit: 80, type: "camera", description: "Fixed camera at Ruai junction on Eastern Bypass. Limit: 80 km/h" },
  { id: "sz077", name: "Eastern Bypass – Kamulu / Utawala Interchange", road: "Eastern Bypass", lat: -1.279312, lng: 36.965667, speedLimit: 80, type: "camera", description: "Fixed camera at Kamulu interchange / Utawala on Eastern Bypass. Limit: 80 km/h" },
  { id: "sz078", name: "Gitaru Road – Kanyariri Camera", road: "Gitaru Road", lat: -1.236009, lng: 36.692304, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on Gitaru Road near Kanyariri, Kabete. Limit: 80 km/h" },

  // ── Nairobi Expressway – additional cameras (NTSA 2025) ──────────────────────
  { id: "sz079", name: "Expressway – Mlolongo Toll Plaza Camera", road: "Nairobi Expressway", lat: -1.37765, lng: 36.928444, speedLimit: 60, type: "camera", description: "Fixed camera in the Mlolongo Toll Plaza (entry/exit) zone. Limit: 60 km/h" },
  { id: "sz080", name: "Expressway – Cabanas Ramp Camera", road: "Nairobi Expressway", lat: -1.335068, lng: 36.892129, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Cabanas Ramp on the Expressway. Limit: 80 km/h" },
  { id: "sz081", name: "Red Hill Road Speed Zone", road: "Red Hill Road", lat: -1.228, lng: 36.7825, speedLimit: 50, type: "zone", description: "50 km/h zone on Red Hill Road near the Limuru/Expressway approach." },

  // Source: NTSA 2025 — Lang'ata Road 60 km/h (urban arterial).
  { id: "sz082", name: "Lang'ata Road – T-Mall Flyover Camera", road: "Lang'ata Road", lat: -1.312079, lng: 36.816718, speedLimit: 60, type: "camera", description: "Fixed camera at the T-Mall flyover on Lang'ata Road. Limit: 60 km/h" },
  { id: "sz083", name: "Lang'ata Road – Uhuru Gardens Camera", road: "Lang'ata Road", lat: -1.325903, lng: 36.799471, speedLimit: 60, type: "camera", description: "Fixed camera opposite Uhuru Gardens on Lang'ata Road. Limit: 60 km/h" },
  // Source: NTSA 2025 — Southern Bypass Kikuyu junction approach 100 km/h open section.
  { id: "sz084", name: "Southern Bypass – Kikuyu Junction Approach", road: "Southern Bypass", lat: -1.246534, lng: 36.664781, speedLimit: 100, type: "camera", description: "Fixed camera on Southern Bypass near Kikuyu junction. Open section: 100 km/h" },
  { id: "sz085", name: "Western Bypass – Ruaka / Wangige Camera", road: "Western Bypass", lat: -1.204791, lng: 36.787081, speedLimit: 80, type: "camera", description: "Fixed camera on the Western Bypass near Ruaka. Limit: 80 km/h" },
  // Source: NTSA 2025 — Northern Bypass (C63) cameras at Ruiru / Thika Road junction.
  { id: "sz086", name: "Northern Bypass – Ruiru / Thika Road Junction", road: "Northern Bypass", lat: -1.187989, lng: 36.880918, speedLimit: 80, type: "camera", description: "Fixed camera on Northern Bypass at Ruiru / Thika Road junction (C63). Limit: 80 km/h" },
  { id: "sz087", name: "Northern Bypass – Kasarani Stadium Camera", road: "Northern Bypass", lat: -1.203462, lng: 36.887637, speedLimit: 80, type: "camera", description: "Mobile units reported near Kasarani Stadium exit on Northern Bypass. Limit: 80 km/h" },
  { id: "sz088", name: "Embu–Nairobi Highway – Makenji/Kabati Zone", road: "Embu–Nairobi Highway (A2/A3)", lat: -0.952984, lng: 37.107709, speedLimit: 50, type: "zone", description: "Built-up area zone at Makenji, Kabati on the Embu–Nairobi Highway. Limit: 50 km/h" },
  { id: "sz089", name: "Kisii–Rongo Road – Suneka Camera", road: "Kisii–Rongo Road", lat: -0.664765, lng: 34.665106, speedLimit: 50, type: "camera", description: "Mobile speed check at Suneka on the Kisii–Rongo Road. Limit: 50 km/h" },
  { id: "sz090", name: "Kisumu–Vihiga Road – Kona Mbaya Camera", road: "Kisumu–Vihiga Road", lat: -0.09258, lng: 34.779912, speedLimit: 50, type: "camera", description: "Mobile speed check towards Kona Mbaya on the Kisumu–Vihiga Road. Limit: 50 km/h" },

  // Source: NTSA 2025 — Uhuru Highway Community / University Way junction 60 km/h.
  { id: "sz091", name: "Uhuru Highway – University Way Junction Camera", road: "University Way", lat: -1.280882, lng: 36.816591, speedLimit: 60, type: "camera", description: "Fixed camera on Uhuru Highway at Community / University Way junction. Limit: 60 km/h" },
  { id: "sz092", name: "Jamboni – Mayo Supermarket Camera", road: "A104 (Eldoret–Nakuru)", lat: 0.472844, lng: 35.299776, speedLimit: 100, type: "camera", description: "Mobile speed check near Mayo Supermarket at Jamboni, south of Eldoret. Limit: 100 km/h" },
  { id: "sz093", name: "Eldoret–Nakuru Highway – Burnt Forest/Nabkoi Camera", road: "A104 (Eldoret–Nakuru)", lat: 0.154935, lng: 35.469728, speedLimit: 80, type: "camera", description: "Fixed camera just past Nabkoi near Burnt Forest on the Eldoret–Nakuru Highway. Limit: 80 km/h" },
  { id: "sz094", name: "Eldoret Southern Bypass Camera", road: "Eldoret Southern Bypass", lat: 0.450327, lng: 35.243721, speedLimit: 80, type: "camera", description: "Mobile speed check on the Eldoret Southern Bypass. Limit: 80 km/h" },

  // ── New cameras from NTSA 2025 authoritative source ───────────────────────────

  // --- Mombasa Road – Nairobi urban fixed cameras ---
  { id: "sz095", name: "Mombasa Rd – South C / Enterprise Rd Junction", road: "Mombasa Road", lat: -1.313, lng: 36.836, speedLimit: 60, type: "camera", description: "Fixed camera at South C / Enterprise Road junction on Mombasa Road. Limit: 60 km/h" },
  { id: "sz096", name: "Mombasa Rd – Bellevue / Coast Bus Stage", road: "Mombasa Road", lat: -1.321461, lng: 36.841569, speedLimit: 80, type: "camera", description: "Fixed camera at Bellevue / Coast Bus stage area on Mombasa Road. Limit: 80 km/h" },
  { id: "sz097", name: "Mombasa Rd – JKIA Roundabout Approach", road: "Mombasa Road", lat: -1.324, lng: 36.919, speedLimit: 60, type: "camera", description: "Fixed camera at JKIA roundabout approach on Mombasa Road. Limit: 60 km/h" },

  // --- Lang'ata Road ---
  { id: "sz098", name: "Lang'ata Rd – Wilson Airport Junction", road: "Lang'ata Road", lat: -1.318, lng: 36.823, speedLimit: 60, type: "camera", description: "Fixed camera near Wilson Airport junction on Lang'ata Road. Limit: 60 km/h" },

  // --- Nairobi Expressway – interchanges (NTSA 2025) ---
  { id: "sz099", name: "Expressway – James Gichuru Interchange", road: "Nairobi Expressway", lat: -1.2674, lng: 36.7744, speedLimit: 80, type: "camera", description: "Fixed camera at James Gichuru Interchange on the Nairobi Expressway. Limit: 80 km/h" },
  { id: "sz100", name: "Expressway – Westlands Ramp", road: "Nairobi Expressway", lat: -1.266, lng: 36.808, speedLimit: 80, type: "camera", description: "Fixed camera at Westlands Ramp area on the Nairobi Expressway. Limit: 80 km/h" },

  // --- Waiyaki Way – additional fixed cameras (NTSA 2025) ---
  { id: "sz101", name: "Waiyaki Way – Mountain View Estate", road: "Waiyaki Way", lat: -1.268, lng: 36.742, speedLimit: 80, type: "camera", description: "Fixed pole camera at Mountain View Estate approach on Waiyaki Way. Limit: 80 km/h" },
  { id: "sz102", name: "Waiyaki Way – Kikuyu Road Junction", road: "Waiyaki Way", lat: -1.261, lng: 36.731, speedLimit: 80, type: "camera", description: "Fixed pole camera at Kikuyu Road junction on Waiyaki Way. Limit: 80 km/h" },

  // --- Ngong Road – additional cameras (NTSA 2025) ---
  { id: "sz103", name: "Ngong Road – Karen Shopping Centre", road: "Ngong Road", lat: -1.322362, lng: 36.706744, speedLimit: 50, type: "camera", description: "Fixed camera at Karen Shopping Centre area on Ngong Road. Limit: 50 km/h" },
  { id: "sz104", name: "Ngong Road – Dagoretti Corner", road: "Ngong Road", lat: -1.299688, lng: 36.75926, speedLimit: 60, type: "police", description: "Mobile enforcement hotspot at Dagoretti Corner on Ngong Road. Very frequent, especially mornings. Limit: 60 km/h" },

  // --- Outer Ring Road – additional cameras (NTSA 2025) ---
  { id: "sz105", name: "Outer Ring Road – Mowlem / Eastleigh South", road: "Outer Ring Road", lat: -1.278575, lng: 36.882149, speedLimit: 60, type: "camera", description: "Fixed camera at Mowlem / Eastleigh South junction on Outer Ring Road. Limit: 60 km/h" },
  { id: "sz106", name: "Outer Ring Road – Taj Mall / Fedha Section", road: "Outer Ring Road", lat: -1.320558, lng: 36.897817, speedLimit: 60, type: "camera", description: "Fixed camera at Taj Mall / Fedha section on Outer Ring Road. Limit: 60 km/h" },

  // --- Limuru Road ---
  { id: "sz107", name: "Limuru Road – Muthaiga / UN Avenue Junction", road: "Limuru Road", lat: -1.235, lng: 36.817, speedLimit: 60, type: "camera", description: "Fixed camera at Muthaiga / UN Avenue junction on Limuru Road. Limit: 60 km/h" },

  // --- Kiambu Road ---
  { id: "sz108", name: "Kiambu Road – Muthaiga Roundabout", road: "Kiambu Road", lat: -1.249, lng: 36.839, speedLimit: 60, type: "camera", description: "Fixed camera at Muthaiga roundabout approach on Kiambu Road. Limit: 60 km/h" },
];
