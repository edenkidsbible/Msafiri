export type ZoneType = "camera" | "police" | "zone";

export interface SpeedZone {
  id: string;
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
  // --- Mombasa Road (A109) ---
  { id: "sz001", name: "Mlolongo Speed Camera", road: "Mombasa Road (A109)", lat: -1.394615, lng: 36.942946, speedLimit: 50, type: "camera", description: "Fixed ANPR camera. Town limit: 50 km/h" },
  { id: "sz002", name: "Athi River Camera", road: "Mombasa Road (A109)", lat: -1.456056, lng: 36.987783, speedLimit: 50, type: "camera", description: "Fixed camera at Athi River town. Limit: 50 km/h" },
  { id: "sz003", name: "Machakos Junction Police", road: "Mombasa Road (A109)", lat: -1.484211, lng: 37.019028, speedLimit: 80, type: "police", description: "Frequent radar checks. Limit: 80 km/h" },
  { id: "sz004", name: "EPZ Syokimau Camera", road: "Mombasa Road (A109)", lat: -1.324708, lng: 36.890792, speedLimit: 80, type: "camera", description: "ANPR camera – industrial section. Limit: 80 km/h" },
  { id: "sz005", name: "Sultan Hamud Camera", road: "Mombasa Road (A109)", lat: -2.01618, lng: 37.373908, speedLimit: 50, type: "camera", description: "Town camera. Limit: 50 km/h" },
  { id: "sz006", name: "Voi Speed Camera", road: "Mombasa Road (A109)", lat: -3.396404, lng: 38.558692, speedLimit: 50, type: "camera", description: "Voi town camera. Limit: 50 km/h" },
  { id: "sz007", name: "Mariakani Police Check", road: "Mombasa Road (A109)", lat: -3.863991, lng: 39.453984, speedLimit: 80, type: "police", description: "Regular radar checks at Mariakani" },
  { id: "sz008", name: "Mombasa Entry Camera", road: "Mombasa Road (A109)", lat: -4.043498, lng: 39.668191, speedLimit: 50, type: "camera", description: "City entry camera. Limit: 50 km/h" },

  // --- Thika Superhighway (A2) ---
  // Coordinates verified/corrected against real-world geocoding (Photon) — these were
  // previously placed several km off the actual Thika Rd corridor (up to ~12km for Thika Town).
  { id: "sz009", name: "Thika Road Camera – Githurai", road: "Thika Superhighway (A2)", lat: -1.190102, lng: 36.913352, speedLimit: 80, type: "camera", description: "ANPR camera at Githurai. Limit: 80 km/h" },
  { id: "sz010", name: "Thika Road Camera – Garden City", road: "Thika Superhighway (A2)", lat: -1.219005, lng: 36.885644, speedLimit: 80, type: "camera", description: "ANPR camera near Garden City Mall. Limit: 80 km/h" },
  { id: "sz011", name: "Thika Town Speed Zone", road: "Thika Superhighway (A2)", lat: -1.039607, lng: 37.087016, speedLimit: 50, type: "zone", description: "Town limit: 50 km/h" },

  // --- Waiyaki Way ---
  { id: "sz012", name: "Waiyaki Way – Westlands Camera", road: "Waiyaki Way", lat: -1.266084, lng: 36.810834, speedLimit: 80, type: "camera", description: "Fixed camera near Westlands. Limit: 80 km/h" },
  { id: "sz013", name: "Waiyaki Way – ABC Police", road: "Waiyaki Way", lat: -1.258861, lng: 36.798606, speedLimit: 80, type: "police", description: "Radar checkpoint near ABC Place" },

  // --- Ngong Road ---
  { id: "sz014", name: "Ngong Road Camera – Junction", road: "Ngong Road", lat: -1.300001, lng: 36.769948, speedLimit: 80, type: "camera", description: "Fixed ANPR camera. Limit: 80 km/h" },

  // --- Outer Ring Road ---
  { id: "sz015", name: "Outer Ring Camera – Embakasi", road: "Outer Ring Road", lat: -1.295123, lng: 36.880008, speedLimit: 80, type: "camera", description: "Camera near Embakasi on Outer Ring Road. Limit: 80 km/h" },

  // --- Lang'ata Road ---
  { id: "sz016", name: "Lang'ata Road Camera", road: "Lang'ata Road", lat: -1.359324, lng: 36.756494, speedLimit: 80, type: "camera", description: "Fixed camera. Limit: 80 km/h" },

  // --- Nakuru Road (A104) ---
  { id: "sz017", name: "Limuru Police Radar", road: "Nakuru Road (A104)", lat: -1.116812, lng: 36.632839, speedLimit: 50, type: "police", description: "Radar on steep descent into Limuru. Limit: 50 km/h" },
  { id: "sz018", name: "Naivasha Speed Camera", road: "Nakuru Road (A104)", lat: -0.716737, lng: 36.431032, speedLimit: 50, type: "camera", description: "Town camera. Limit: 50 km/h" },
  { id: "sz019", name: "Nakuru Town Entry Camera", road: "Nakuru Road (A104)", lat: -0.303109, lng: 36.079983, speedLimit: 50, type: "camera", description: "Entry camera. Limit: 50 km/h" },

  // --- Eldoret / A104 north ---
  { id: "sz020", name: "Eldoret Entry Camera", road: "A104 (Nakuru–Eldoret)", lat: 0.51424, lng: 35.269842, speedLimit: 50, type: "camera", description: "Eldoret town entry. Limit: 50 km/h" },
  { id: "sz021", name: "Nakuru–Eldoret Police Check", road: "A104 Highway", lat: 0.158125, lng: 35.621692, speedLimit: 100, type: "police", description: "Regular radar on highway. Limit: 100 km/h" },

  // --- Kisumu ---
  { id: "sz022", name: "Kisumu City Camera", road: "Kisumu Road", lat: -0.1022, lng: 34.7617, speedLimit: 50, type: "camera", description: "City centre camera. Limit: 50 km/h" },
  { id: "sz023", name: "Narok Police Check", road: "B3 Kisumu Highway", lat: -1.083439, lng: 35.866892, speedLimit: 80, type: "police", description: "Police radar on Kisumu highway" },

  // --- Nairobi CBD / Enterprise ---
  { id: "sz024", name: "Enterprise Road Camera", road: "Enterprise Road", lat: -1.3110, lng: 36.8490, speedLimit: 50, type: "camera", description: "Industrial area camera. Limit: 50 km/h" },
  { id: "sz025", name: "Karen Residential Zone", road: "Karen Road", lat: -1.36, lng: 36.71, speedLimit: 50, type: "zone", description: "Residential area. Limit: 50 km/h" },

  // --- Nairobi Expressway ---
  { id: "sz026", name: "Expressway – Museum Hill/Westlands Camera", road: "Nairobi Expressway", lat: -1.2711, lng: 36.821509, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on elevated expressway, Museum Hill–Westlands section. Limit: 80 km/h" },
  { id: "sz027", name: "Expressway – After Nyayo Stadium Camera", road: "Nairobi Expressway", lat: -1.306188, lng: 36.824771, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on elevated expressway past Nyayo Stadium. Limit: 80 km/h" },

  // --- Thika Superhighway (A2) – additional corridor cameras ---
  { id: "sz028", name: "Thika Road – Pangani/Muthaiga Interchange", road: "Thika Superhighway (A2)", lat: -1.265981, lng: 36.838013, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Pangani/Muthaiga interchange. Limit: 80 km/h" },
  { id: "sz029", name: "Thika Road – Allsops/GSU HQ", road: "Thika Superhighway (A2)", lat: -1.244835, lng: 36.864646, speedLimit: 80, type: "camera", description: "Fixed ANPR camera opposite GSU Headquarters at Allsops. Limit: 80 km/h" },
  { id: "sz030", name: "Thika Road – Roysambu/TRM", road: "Thika Superhighway (A2)", lat: -1.218924, lng: 36.885392, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Roysambu near TRM Mall. Limit: 80 km/h" },
  { id: "sz031", name: "Thika Road – Safari Park", road: "Thika Superhighway (A2)", lat: -1.226279, lng: 36.883986, speedLimit: 100, type: "camera", description: "Mobile speed check near Safari Park Hotel heading towards Kasarani. Limit: 100 km/h" },
  { id: "sz032", name: "Thika Road – Jomoko Turnoff", road: "Thika Superhighway (A2)", lat: -1.139311, lng: 36.968921, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Jomoko turnoff between Ruiru and Juja. Limit: 80 km/h" },

  // --- Southern & Northern Bypass ---
  { id: "sz033", name: "Southern Bypass – Virtual Weighbridge", road: "Southern Bypass", lat: -1.318828, lng: 36.723157, speedLimit: 80, type: "camera", description: "Virtual weighbridge enforcement point on Southern Bypass. Limit: 80 km/h" },
  { id: "sz034", name: "Northern Bypass – Gitaru/Wangige", road: "Northern Bypass", lat: -1.216809, lng: 36.751062, speedLimit: 80, type: "camera", description: "Mobile enforcement point after Gitaru near Wangige on Northern Bypass. Limit: 80 km/h" },

  // --- Mombasa Road (A109) – additional stretches ---
  // sz035/sz035b: paired entries at BOTH ends so drivers approaching from either direction are warned
  { id: "sz035",  name: "Mombasa Rd Zone – Nyayo Stadium end",    road: "Mombasa Road (A109)", lat: -1.30875, lng: 36.828441, speedLimit: 80, type: "zone", description: "Speed zone: Nyayo Stadium → Sameer Business Park. Approaching from Nairobi CBD side. Limit: 80 km/h" },
  { id: "sz035b", name: "Mombasa Rd Zone – Sameer Business Park end", road: "Mombasa Road (A109)", lat: -1.322483, lng: 36.869734, speedLimit: 80, type: "zone", description: "Speed zone: Nyayo Stadium → Sameer Business Park. Approaching from Mlolongo/JKIA side. Limit: 80 km/h" },
  { id: "sz036", name: "Mombasa Road – Cabanas/JKIA Camera", road: "Mombasa Road (A109)", lat: -1.317537, lng: 36.922413, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Cabanas near JKIA junction. Limit: 80 km/h" },

  // --- Waiyaki Way – additional zone ---
  // sz037/sz037b: paired entries at BOTH ends of the Kangemi–Uthiru stretch
  { id: "sz037",  name: "Waiyaki Way Zone – Kangemi end", road: "Waiyaki Way", lat: -1.266409, lng: 36.744651, speedLimit: 60, type: "zone", description: "Built-up area zone: Kangemi → Uthiru. Approaching from Nairobi/Westlands side. Limit: 60 km/h" },
  { id: "sz037b", name: "Waiyaki Way Zone – Uthiru end",  road: "Waiyaki Way", lat: -1.258105, lng: 36.71359, speedLimit: 60, type: "zone", description: "Built-up area zone: Kangemi → Uthiru. Approaching from Kikuyu/Dagoretti side. Limit: 60 km/h" },

  // --- A2 Highway – Nairobi–Nyeri corridor town zones ---
  { id: "sz038", name: "Kenol Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.913454, lng: 37.070282, speedLimit: 50, type: "zone", description: "Built-up area limit through Kenol town. Limit: 50 km/h" },
  { id: "sz039", name: "Makuyu Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.88025, lng: 37.098908, speedLimit: 50, type: "zone", description: "Built-up area limit through Makuyu town. Limit: 50 km/h" },
  { id: "sz040", name: "Sagana Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.671108, lng: 37.21028, speedLimit: 50, type: "zone", description: "Built-up area limit through Sagana town. Limit: 50 km/h" },
  { id: "sz041", name: "Karatina Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.480649, lng: 37.124737, speedLimit: 50, type: "zone", description: "Built-up area limit through Karatina town. Limit: 50 km/h" },
  { id: "sz042", name: "Kanyonyo Weighbridge – Speed Camera", road: "Thika–Garissa Road (A3)", lat: -1.098222, lng: 37.668968, speedLimit: 50, type: "camera", description: "KeNHA static weighbridge at Kanyonyo on the A3, east of Matuu near the Machakos/Kitui border. Limit: 50 km/h" },

  // ── OSM-sourced speed cameras (tagged highway=speed_camera in OpenStreetMap) ──
  { id: "sz043", name: "Museum Hill / Chiromo Camera", road: "Chiromo Road (A8)", lat: -1.2898, lng: 36.8188, speedLimit: 80, type: "camera", description: "OSM-tagged fixed camera at Museum Hill / Chiromo Road junction. Limit: 80 km/h" },
  { id: "sz044", name: "Kapsabet / Turbo Camera", road: "Eldoret–Kapsabet Road", lat: 0.199944, lng: 35.100815, speedLimit: 80, type: "camera", description: "OSM-tagged fixed camera near Kapsabet / Turbo junction, west of Eldoret. Limit: 80 km/h" },
  { id: "sz045", name: "Mbagathi / Lang'ata Camera", road: "Lang'ata Road", lat: -1.325267, lng: 36.753195, speedLimit: 100, type: "camera", description: "OSM-tagged camera on Lang'ata Road near Mbagathi. Limit: 100 km/h" },

  // ── A7 Coastal Corridor – Mombasa to Malindi & beyond (OSM maxspeed data) ──
  { id: "sz046", name: "Nyali Bridge Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -4.0429, lng: 39.6724, speedLimit: 50, type: "zone", description: "Controlled zone on Nyali Bridge – Mombasa approach. Limit: 50 km/h" },
  { id: "sz047", name: "Mtwapa Bridge Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -3.9554, lng: 39.7415, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h zone at Mtwapa Bridge, north of Mombasa. Limit: 50 km/h" },
  { id: "sz048", name: "Kilifi Bridge Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -3.6362, lng: 39.8485, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h zone at Kilifi Bridge. Limit: 50 km/h" },
  { id: "sz049", name: "Malindi Town Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -3.2175, lng: 40.1191, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h built-up zone through Malindi town. Limit: 50 km/h" },
  { id: "sz050", name: "Malindi Open Road Zone", road: "A7 North of Malindi", lat: -3.113251, lng: 40.157361, speedLimit: 80, type: "zone", description: "Open highway section near Mambrui, north of Malindi towards Lamu – OSM maxspeed 80 km/h. Limit: 80 km/h" },
  { id: "sz051", name: "Lungalunga Border Zone", road: "A7 Lungalunga–Ramisi", lat: -4.537808, lng: 39.161664, speedLimit: 50, type: "zone", description: "Speed-controlled zone at Lungalunga border post. Limit: 50 km/h" },

  // ── Western Kenya corridors (OSM maxspeed data) ──
  { id: "sz052", name: "A12 Kisumu–Busia Highway", road: "A12 (Kisumu–Busia)", lat: 0.21459, lng: 34.261288, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk highway — Kisumu to Busia corridor." },
  { id: "sz053", name: "A12 Kericho–Kisumu Highway", road: "A12 (Kericho–Kisumu)", lat: -0.264256, lng: 35.461105, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk road — Kericho to Kisumu. Regular radar checks." },
  { id: "sz054", name: "B1 Migori Highway Zone", road: "B1 (Kisii–Migori)", lat: -1.066695, lng: 34.466975, speedLimit: 100, type: "zone", description: "OSM-tagged 100 km/h trunk section on B1 near Migori. Limit: 100 km/h" },
  { id: "sz055", name: "B17 Nakuru–Marigat Highway", road: "B17 (Nakuru–Marigat)", lat: -0.0126, lng: 35.9644, speedLimit: 100, type: "zone", description: "OSM-tagged 100 km/h primary road — Nakuru to Marigat. Limit: 100 km/h" },
  { id: "sz056", name: "B18 Narok–Mau Narok–Njoro Zone", road: "B18 (Narok–Njoro)", lat: -0.7726, lng: 35.8958, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk road — Narok to Mau Narok to Njoro. Limit: 80 km/h" },

  // ── Eastern Kenya / Mt Kenya region (OSM maxspeed data) ──
  { id: "sz057", name: "A9 Embu–Siakago Highway", road: "A9 (Embu–Siakago)", lat: -0.558203, lng: 37.546487, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk road — Embu to Siakago. Limit: 80 km/h" },
  { id: "sz058", name: "D490 Ruiri–Isiolo Road", road: "D490 (Ruiri–Isiolo)", lat: 0.234868, lng: 37.612488, speedLimit: 110, type: "zone", description: "Open semi-arid road — Ruiri to Isiolo. OSM-tagged high limit; drive to conditions. Limit: 110 km/h" },
  { id: "sz059", name: "Airport North Road Zone", road: "Airport North Road", lat: -1.317996, lng: 36.921416, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h — Airport North Road near JKIA. Limit: 50 km/h" },

  // ── A8 Eldoret corridor (OSM maxspeed data) ──
  { id: "sz060", name: "A8 Eldoret–Nakuru Open Highway", road: "A8 (Eldoret–Nakuru)", lat: 0.451985, lng: 35.30695, speedLimit: 110, type: "zone", description: "OSM-tagged 110 km/h open highway — Eldoret to Nakuru. Limit: 110 km/h" },
  { id: "sz061", name: "A8 Eldoret–Nakuru Mid-Section", road: "A8 (Eldoret–Nakuru)", lat: 0.243186, lng: 35.416645, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h section — built-up mid-route between Eldoret and Nakuru. Limit: 80 km/h" },
  { id: "sz062", name: "A8 Malaba Border – Open Highway", road: "A8 (Eldoret–Malaba)", lat: 0.632723, lng: 34.271231, speedLimit: 110, type: "zone", description: "OSM-tagged 110 km/h trunk — Eldoret to Malaba border. Limit: 110 km/h" },

  // ── Police checkpoint zones (sourced from OSM amenity=police near major corridors) ──
  { id: "sz063", name: "Langata Police Checkpoint Zone", road: "Lang'ata Road", lat: -1.33199, lng: 36.781995, speedLimit: 50, type: "police", description: "Langata Police Station — frequent radar stops on Langata Road. Limit: 50 km/h" },
  { id: "sz064", name: "Karen Police Checkpoint Zone", road: "Karen Road / Ngong Road", lat: -1.3218, lng: 36.7061, speedLimit: 50, type: "police", description: "Karen Police Station — residential speed checks. Limit: 50 km/h" },
  { id: "sz065", name: "Kilimani Police Checkpoint Zone", road: "Ngong Road", lat: -1.291798, lng: 36.79511, speedLimit: 80, type: "police", description: "Kilimani Divisional Police — radar on Ngong Road near Police Line. Limit: 80 km/h" },
  { id: "sz066", name: "Ngong Police Checkpoint", road: "Ngong Road", lat: -1.365336, lng: 36.653725, speedLimit: 50, type: "police", description: "Ngong Police Station — checkpoint at Ngong town entry. Limit: 50 km/h" },
  { id: "sz067", name: "Rongai / Bomas Police Check", road: "Magadi Road / Bomas", lat: -1.3971, lng: 36.7569, speedLimit: 50, type: "police", description: "Rongai Police — frequent checkpoint near Bomas of Kenya junction. Limit: 50 km/h" },
  { id: "sz068", name: "Muthaiga Police Checkpoint", road: "Thika Superhighway (A2)", lat: -1.259783, lng: 36.842744, speedLimit: 80, type: "police", description: "Muthaiga Police Station — radar stops near Thika Road Muthaiga junction. Limit: 80 km/h" },
  { id: "sz069", name: "Bamburi Police Checkpoint (Mombasa)", road: "A7 Malindi Road", lat: -3.999696, lng: 39.728051, speedLimit: 80, type: "police", description: "Bamburi Police — radar on Malindi Road north of Mombasa. Limit: 80 km/h" },
  { id: "sz070", name: "Diani Police Checkpoint (South Coast)", road: "Diani Beach Road", lat: -4.282796, lng: 39.566519, speedLimit: 50, type: "police", description: "Diani Police Station — checkpoint on South Coast road. Limit: 50 km/h" },
  { id: "sz071", name: "Nyali Police Checkpoint (Mombasa)", road: "A7 Nyali", lat: -4.052709, lng: 39.693324, speedLimit: 50, type: "police", description: "Nyali Police Station — speed checks near Nyali Bridge. Limit: 50 km/h" },
  { id: "sz072", name: "Kericho Police Checkpoint", road: "A12 / Kericho Town", lat: -0.367833, lng: 35.287581, speedLimit: 50, type: "police", description: "Kericho Police Station — checkpoint at town entry on A12. Limit: 50 km/h" },
  { id: "sz073", name: "Naivasha Police Checkpoint", road: "A104 (Nakuru Road)", lat: -0.77428, lng: 36.426531, speedLimit: 50, type: "police", description: "Police post on Nakuru road near Naivasha — regular speed checks. Limit: 50 km/h" },

  // --- Southern & Northern Bypass – additional points (NTSA city highway list) ---
  { id: "sz074", name: "Southern Bypass – Ngong Road Interchange", road: "Southern Bypass", lat: -1.3633, lng: 36.737619, speedLimit: 80, type: "camera", description: "NTSA-monitored interchange where the Southern Bypass meets Ngong Road. Limit: 80 km/h" },
  { id: "sz075", name: "Northern Bypass – Ruaka/Wangige Stretch", road: "Northern Bypass", lat: -1.203869, lng: 36.780508, speedLimit: 80, type: "camera", description: "NTSA-monitored stretch near Ruaka, on the Northern Bypass approach to Wangige. Limit: 80 km/h" },

  // ── Sourced from speedcamke.com crowdsourced reports + Pulse.co.ke NTSA smart-camera
  // coverage article (Jul 2026). Coordinates geocoded from named landmarks/junctions. ──
  { id: "sz076", name: "Eastern Bypass – Opp. Nyayo/Embakasi Barracks", road: "Eastern Bypass", lat: -1.303011, lng: 36.936395, speedLimit: 80, type: "camera", description: "Mobile speed enforcement reported opposite Nyayo/Embakasi Barracks on the Eastern Bypass. Limit: 80 km/h" },
  { id: "sz077", name: "Eastern Bypass – Magunas, Utawala Zone", road: "Eastern Bypass", lat: -1.279312, lng: 36.965667, speedLimit: 50, type: "zone", description: "Built-up area zone at Magunas, Utawala — enforced on both sides of the road. Limit: 50 km/h" },
  { id: "sz078", name: "Gitaru Road – Kanyariri Camera", road: "Gitaru Road", lat: -1.236009, lng: 36.692304, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on Gitaru Road near Kanyariri, Kabete. Limit: 80 km/h" },
  { id: "sz079", name: "Expressway – Syokimau Footbridge Camera", road: "Nairobi Expressway", lat: -1.37765, lng: 36.928444, speedLimit: 50, type: "camera", description: "Fixed camera under the Syokimau footbridge on the Nairobi Expressway. Limit: 50 km/h" },
  { id: "sz080", name: "Expressway – Cabanas/Airtel Interchange Camera", road: "Nairobi Expressway", lat: -1.335068, lng: 36.892129, speedLimit: 80, type: "camera", description: "Fixed ANPR camera between Cabanas and Airtel interchange on the Expressway. Limit: 80 km/h" },
  { id: "sz081", name: "Red Hill Road Speed Zone", road: "Red Hill Road", lat: -1.1688, lng: 36.7067, speedLimit: 50, type: "zone", description: "Signposted 50 km/h zone on Red Hill Road near the Limuru/Expressway approach. Limit: 50 km/h" },
  { id: "sz082", name: "Lang'ata Road – T-Mall Flyover Camera", road: "Lang'ata Road", lat: -1.312079, lng: 36.816718, speedLimit: 50, type: "camera", description: "Fixed camera at the T-Mall flyover, towards Madaraka. Limit: 50 km/h" },
  { id: "sz083", name: "Lang'ata Road – Uhuru Gardens Camera", road: "Lang'ata Road", lat: -1.325903, lng: 36.799471, speedLimit: 50, type: "camera", description: "Fixed camera opposite Uhuru Gardens on Lang'ata Road. Limit: 50 km/h" },
  { id: "sz084", name: "Southern Bypass – Kikuyu Approach Camera", road: "Southern Bypass", lat: -1.246534, lng: 36.664781, speedLimit: 80, type: "camera", description: "Fixed camera on the Southern Bypass approaching Kikuyu. Limit: 80 km/h" },
  { id: "sz085", name: "Western Bypass – Ruaka/Wangige Camera", road: "Western Bypass", lat: -1.2047, lng: 36.7871, speedLimit: 80, type: "camera", description: "Fixed camera on the Western Bypass near Ruaka, on the Wangige approach. Limit: 80 km/h" },
  { id: "sz086", name: "Northern Bypass – Ruaka/Ruiru Stretch", road: "Northern Bypass", lat: -1.187989, lng: 36.880918, speedLimit: 80, type: "camera", description: "Fixed camera on the Northern Bypass between Ruaka and Ruiru. Limit: 80 km/h" },
  { id: "sz087", name: "Northern Bypass – Grace Chapel Camera", road: "Northern Bypass", lat: -1.203462, lng: 36.887637, speedLimit: 50, type: "camera", description: "Fixed camera near Nairobi Grace Chapel on the Northern Bypass. Limit: 50 km/h" },
  { id: "sz088", name: "Embu–Nairobi Highway – Makenji/Kabati Zone", road: "Embu–Nairobi Highway (A2/A3)", lat: -0.9530, lng: 37.1077, speedLimit: 50, type: "zone", description: "Built-up area zone at Makenji, Kabati on the Embu–Nairobi Highway. Limit: 50 km/h" },
  { id: "sz089", name: "Kisii–Rongo Road – Suneka Camera", road: "Kisii–Rongo Road", lat: -0.664765, lng: 34.665106, speedLimit: 50, type: "camera", description: "Mobile speed check reported at Suneka on the Kisii–Rongo Road. Limit: 50 km/h" },
  { id: "sz090", name: "Kisumu–Vihiga Road – Kona Mbaya Camera", road: "Kisumu–Vihiga Road", lat: -0.0926, lng: 34.7799, speedLimit: 50, type: "camera", description: "Mobile speed check reported towards Kona Mbaya on the Kisumu–Vihiga Road. Limit: 50 km/h" },

  // ── Previously skipped speedcamke.com reports, resolved using user-supplied Plus Codes ──
  { id: "sz091", name: "University Way Camera", road: "University Way", lat: -1.2809, lng: 36.8166, speedLimit: 50, type: "camera", description: "Fixed camera on University Way, Nairobi CBD, near the University of Nairobi Main Campus. Limit: 50 km/h" },
  { id: "sz092", name: "Jamboni – Mayo Supermarket Camera", road: "A104 (Eldoret–Nakuru)", lat: 0.4729, lng: 35.2998, speedLimit: 100, type: "camera", description: "Mobile speed check near Mayo Supermarket at Jamboni, south of Eldoret. Limit: 100 km/h" },
  { id: "sz093", name: "Eldoret–Nakuru Highway – Burnt Forest/Nabkoi Camera", road: "A104 (Eldoret–Nakuru)", lat: 0.154935, lng: 35.469728, speedLimit: 80, type: "camera", description: "Fixed camera just past Nabkoi shopping center, near Burnt Forest on the Eldoret–Nakuru Highway. Limit: 80 km/h" },
  { id: "sz094", name: "Eldoret Southern Bypass Camera", road: "Eldoret Southern Bypass", lat: 0.4504, lng: 35.2438, speedLimit: 80, type: "camera", description: "Mobile speed check on the Eldoret Southern Bypass. Limit: 80 km/h" },
];
