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
}

export const SPEED_ZONES: SpeedZone[] = [
  // --- Mombasa Road (A109) ---
  { id: "sz001", name: "Mlolongo Speed Camera", road: "Mombasa Road (A109)", lat: -1.5074, lng: 37.0207, speedLimit: 50, type: "camera", description: "Fixed ANPR camera. Town limit: 50 km/h" },
  { id: "sz002", name: "Athi River Camera", road: "Mombasa Road (A109)", lat: -1.456, lng: 36.9878, speedLimit: 50, type: "camera", description: "Fixed camera at Athi River town. Limit: 50 km/h" },
  { id: "sz003", name: "Machakos Junction Police", road: "Mombasa Road (A109)", lat: -1.4833, lng: 37.0167, speedLimit: 80, type: "police", description: "Frequent radar checks. Limit: 80 km/h" },
  { id: "sz004", name: "EPZ Syokimau Camera", road: "Mombasa Road (A109)", lat: -1.3239, lng: 36.892, speedLimit: 80, type: "camera", description: "ANPR camera – industrial section. Limit: 80 km/h" },
  { id: "sz005", name: "Sultan Hamud Camera", road: "Mombasa Road (A109)", lat: -2.0411, lng: 37.5028, speedLimit: 50, type: "camera", description: "Town camera. Limit: 50 km/h" },
  { id: "sz006", name: "Voi Speed Camera", road: "Mombasa Road (A109)", lat: -3.3964, lng: 38.5587, speedLimit: 50, type: "camera", description: "Voi town camera. Limit: 50 km/h" },
  { id: "sz007", name: "Mariakani Police Check", road: "Mombasa Road (A109)", lat: -3.86, lng: 39.45, speedLimit: 80, type: "police", description: "Regular radar checks at Mariakani" },
  { id: "sz008", name: "Mombasa Entry Camera", road: "Mombasa Road (A109)", lat: -4.0435, lng: 39.6682, speedLimit: 50, type: "camera", description: "City entry camera. Limit: 50 km/h" },

  // --- Thika Superhighway (A2) ---
  { id: "sz009", name: "Thika Road Camera – Githurai", road: "Thika Superhighway (A2)", lat: -1.22, lng: 36.89, speedLimit: 80, type: "camera", description: "ANPR camera. Limit: 80 km/h" },
  { id: "sz010", name: "Thika Road Camera – Garden City", road: "Thika Superhighway (A2)", lat: -1.216, lng: 36.89, speedLimit: 80, type: "camera", description: "ANPR camera near Garden City Mall. Limit: 80 km/h" },
  { id: "sz011", name: "Thika Town Speed Zone", road: "Thika Superhighway (A2)", lat: -1.0332, lng: 37.0693, speedLimit: 50, type: "zone", description: "Town limit: 50 km/h" },

  // --- Waiyaki Way ---
  { id: "sz012", name: "Waiyaki Way – Westlands Camera", road: "Waiyaki Way", lat: -1.2661, lng: 36.8109, speedLimit: 80, type: "camera", description: "Fixed camera near Westlands. Limit: 80 km/h" },
  { id: "sz013", name: "Waiyaki Way – ABC Police", road: "Waiyaki Way", lat: -1.2588, lng: 36.7985, speedLimit: 80, type: "police", description: "Radar checkpoint near ABC Place" },

  // --- Ngong Road ---
  { id: "sz014", name: "Ngong Road Camera – Junction", road: "Ngong Road", lat: -1.3, lng: 36.77, speedLimit: 80, type: "camera", description: "Fixed ANPR camera. Limit: 80 km/h" },

  // --- Outer Ring Road ---
  { id: "sz015", name: "Outer Ring Camera – Embakasi", road: "Outer Ring Road", lat: -1.26, lng: 36.89, speedLimit: 80, type: "camera", description: "Camera near Embakasi. Limit: 80 km/h" },

  // --- Lang'ata Road ---
  { id: "sz016", name: "Lang'ata Road Camera", road: "Lang'ata Road", lat: -1.3593, lng: 36.7568, speedLimit: 80, type: "camera", description: "Fixed camera. Limit: 80 km/h" },

  // --- Nakuru Road (A104) ---
  { id: "sz017", name: "Limuru Police Radar", road: "Nakuru Road (A104)", lat: -1.1167, lng: 36.6333, speedLimit: 50, type: "police", description: "Radar on steep descent into Limuru. Limit: 50 km/h" },
  { id: "sz018", name: "Naivasha Speed Camera", road: "Nakuru Road (A104)", lat: -0.7167, lng: 36.4311, speedLimit: 50, type: "camera", description: "Town camera. Limit: 50 km/h" },
  { id: "sz019", name: "Nakuru Town Entry Camera", road: "Nakuru Road (A104)", lat: -0.3031, lng: 36.08, speedLimit: 50, type: "camera", description: "Entry camera. Limit: 50 km/h" },

  // --- Eldoret / A104 north ---
  { id: "sz020", name: "Eldoret Entry Camera", road: "A104 (Nakuru–Eldoret)", lat: 0.5143, lng: 35.2698, speedLimit: 50, type: "camera", description: "Eldoret town entry. Limit: 50 km/h" },
  { id: "sz021", name: "Nakuru–Eldoret Police Check", road: "A104 Highway", lat: 0.16, lng: 35.62, speedLimit: 100, type: "police", description: "Regular radar on highway. Limit: 100 km/h" },

  // --- Kisumu ---
  { id: "sz022", name: "Kisumu City Camera", road: "Kisumu Road", lat: -0.1022, lng: 34.7617, speedLimit: 50, type: "camera", description: "City centre camera. Limit: 50 km/h" },
  { id: "sz023", name: "Narok Police Check", road: "B3 Kisumu Highway", lat: -1.0833, lng: 35.8667, speedLimit: 80, type: "police", description: "Police radar on Kisumu highway" },

  // --- Nairobi CBD / Enterprise ---
  { id: "sz024", name: "Enterprise Road Camera", road: "Enterprise Road", lat: -1.31, lng: 36.905, speedLimit: 50, type: "camera", description: "Industrial area camera. Limit: 50 km/h" },
  { id: "sz025", name: "Karen Residential Zone", road: "Karen Road", lat: -1.36, lng: 36.71, speedLimit: 50, type: "zone", description: "Residential area. Limit: 50 km/h" },

  // --- Nairobi Expressway ---
  { id: "sz026", name: "Expressway – Museum Hill/Westlands Camera", road: "Nairobi Expressway", lat: -1.2706, lng: 36.8219, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on elevated expressway, Museum Hill–Westlands section. Limit: 80 km/h" },
  { id: "sz027", name: "Expressway – After Nyayo Stadium Camera", road: "Nairobi Expressway", lat: -1.3064, lng: 36.8248, speedLimit: 80, type: "camera", description: "Fixed ANPR camera on elevated expressway past Nyayo Stadium. Limit: 80 km/h" },

  // --- Thika Superhighway (A2) – additional corridor cameras ---
  { id: "sz028", name: "Thika Road – Pangani/Muthaiga Interchange", road: "Thika Superhighway (A2)", lat: -1.2697, lng: 36.8393, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Pangani/Muthaiga interchange. Limit: 80 km/h" },
  { id: "sz029", name: "Thika Road – Allsops/GSU HQ", road: "Thika Superhighway (A2)", lat: -1.2447, lng: 36.8643, speedLimit: 80, type: "camera", description: "Fixed ANPR camera opposite GSU Headquarters at Allsops. Limit: 80 km/h" },
  { id: "sz030", name: "Thika Road – Roysambu/TRM", road: "Thika Superhighway (A2)", lat: -1.2189, lng: 36.8854, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Roysambu near TRM Mall. Limit: 80 km/h" },
  { id: "sz031", name: "Thika Road – Safari Park", road: "Thika Superhighway (A2)", lat: -1.1944, lng: 36.9006, speedLimit: 110, type: "camera", description: "Fixed ANPR camera near Safari Park Hotel. Open highway: 110 km/h" },
  { id: "sz032", name: "Thika Road – Jomoko Turnoff", road: "Thika Superhighway (A2)", lat: -1.1153, lng: 36.9600, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Jomoko turnoff near Ruiru. Limit: 80 km/h" },

  // --- Southern & Northern Bypass ---
  { id: "sz033", name: "Southern Bypass – Virtual Weighbridge", road: "Southern Bypass", lat: -1.3194, lng: 36.7228, speedLimit: 80, type: "camera", description: "Virtual weighbridge enforcement point on Southern Bypass. Limit: 80 km/h" },
  { id: "sz034", name: "Northern Bypass – Gitaru/Wangige", road: "Northern Bypass", lat: -1.2175, lng: 36.7508, speedLimit: 80, type: "camera", description: "Mobile enforcement point after Gitaru near Wangige on Northern Bypass. Limit: 80 km/h" },

  // --- Mombasa Road (A109) – additional stretches ---
  // sz035/sz035b: paired entries at BOTH ends so drivers approaching from either direction are warned
  { id: "sz035",  name: "Mombasa Rd Zone – Nyayo Stadium end",    road: "Mombasa Road (A109)", lat: -1.3100, lng: 36.8253, speedLimit: 80, type: "zone", description: "Speed zone: Nyayo Stadium → Sameer Business Park. Approaching from Nairobi CBD side. Limit: 80 km/h" },
  { id: "sz035b", name: "Mombasa Rd Zone – Sameer Business Park end", road: "Mombasa Road (A109)", lat: -1.3168, lng: 36.8760, speedLimit: 80, type: "zone", description: "Speed zone: Nyayo Stadium → Sameer Business Park. Approaching from Mlolongo/JKIA side. Limit: 80 km/h" },
  { id: "sz036", name: "Mombasa Road – Cabanas/JKIA Camera", road: "Mombasa Road (A109)", lat: -1.3264, lng: 36.9142, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Cabanas near JKIA junction. Limit: 80 km/h" },

  // --- Waiyaki Way – additional zone ---
  // sz037/sz037b: paired entries at BOTH ends of the Kangemi–Uthiru stretch
  { id: "sz037",  name: "Waiyaki Way Zone – Kangemi end", road: "Waiyaki Way", lat: -1.2664, lng: 36.7447, speedLimit: 60, type: "zone", description: "Built-up area zone: Kangemi → Uthiru. Approaching from Nairobi/Westlands side. Limit: 60 km/h" },
  { id: "sz037b", name: "Waiyaki Way Zone – Uthiru end",  road: "Waiyaki Way", lat: -1.2583, lng: 36.7138, speedLimit: 60, type: "zone", description: "Built-up area zone: Kangemi → Uthiru. Approaching from Kikuyu/Dagoretti side. Limit: 60 km/h" },

  // --- A2 Highway – Nairobi–Nyeri corridor town zones ---
  { id: "sz038", name: "Kenol Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.9136, lng: 37.0708, speedLimit: 50, type: "zone", description: "Built-up area limit through Kenol town. Limit: 50 km/h" },
  { id: "sz039", name: "Makuyu Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.8803, lng: 37.0989, speedLimit: 50, type: "zone", description: "Built-up area limit through Makuyu town. Limit: 50 km/h" },
  { id: "sz040", name: "Sagana Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.6711, lng: 37.2103, speedLimit: 50, type: "zone", description: "Built-up area limit through Sagana town. Limit: 50 km/h" },
  { id: "sz041", name: "Karatina Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.4808, lng: 37.1247, speedLimit: 50, type: "zone", description: "Built-up area limit through Karatina town. Limit: 50 km/h" },
  { id: "sz042", name: "Kanyonyo Weighbridge – Speed Camera", road: "Machakos–Matuu Road (C80)", lat: -1.3620, lng: 37.3970, speedLimit: 50, type: "camera", description: "Fixed speed camera at Kanyonyo weighbridge on the Machakos–Matuu stretch. Limit: 50 km/h" },

  // ── OSM-sourced speed cameras (tagged highway=speed_camera in OpenStreetMap) ──
  { id: "sz043", name: "Museum Hill / Chiromo Camera", road: "Chiromo Road (A8)", lat: -1.2898, lng: 36.8188, speedLimit: 80, type: "camera", description: "OSM-tagged fixed camera at Museum Hill / Chiromo Road junction. Limit: 80 km/h" },
  { id: "sz044", name: "Kapsabet / Turbo Camera", road: "A104 (Eldoret–Nakuru)", lat: -0.9890, lng: 35.5586, speedLimit: 80, type: "camera", description: "OSM-tagged fixed camera near Kapsabet / Turbo junction on A104. Limit: 80 km/h" },
  { id: "sz045", name: "Mbagathi / Lang'ata Camera", road: "Lang'ata Road", lat: -1.3253, lng: 36.7532, speedLimit: 100, type: "camera", description: "OSM-tagged camera on Lang'ata Road near Mbagathi. Limit: 100 km/h" },

  // ── A7 Coastal Corridor – Mombasa to Malindi & beyond (OSM maxspeed data) ──
  { id: "sz046", name: "Nyali Bridge Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -4.0429, lng: 39.6724, speedLimit: 50, type: "zone", description: "Controlled zone on Nyali Bridge – Mombasa approach. Limit: 50 km/h" },
  { id: "sz047", name: "Mtwapa Bridge Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -3.9554, lng: 39.7415, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h zone at Mtwapa Bridge, north of Mombasa. Limit: 50 km/h" },
  { id: "sz048", name: "Kilifi Bridge Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -3.6362, lng: 39.8485, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h zone at Kilifi Bridge. Limit: 50 km/h" },
  { id: "sz049", name: "Malindi Town Speed Zone", road: "A7 (Mombasa–Malindi)", lat: -3.9400, lng: 39.7471, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h built-up zone through Malindi town. Limit: 50 km/h" },
  { id: "sz050", name: "Malindi Open Road Zone", road: "A7 North of Malindi", lat: -3.3494, lng: 39.9637, speedLimit: 80, type: "zone", description: "Open highway section north of Malindi – OSM maxspeed 80 km/h. Limit: 80 km/h" },
  { id: "sz051", name: "Lungalunga Border Zone", road: "A7 Lungalunga–Ramisi", lat: -4.5395, lng: 39.1550, speedLimit: 50, type: "zone", description: "Speed-controlled zone at Lungalunga border post. Limit: 50 km/h" },

  // ── Western Kenya corridors (OSM maxspeed data) ──
  { id: "sz052", name: "A12 Kisumu–Busia Highway", road: "A12 (Kisumu–Busia)", lat: 0.2141, lng: 34.2608, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk highway — Kisumu to Busia corridor." },
  { id: "sz053", name: "A12 Kericho–Kisumu Highway", road: "A12 (Kericho–Kisumu)", lat: -0.2645, lng: 35.4614, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk road — Kericho to Kisumu. Regular radar checks." },
  { id: "sz054", name: "B1 Migori Highway Zone", road: "B1 (Kisii–Migori)", lat: -1.0057, lng: 34.1038, speedLimit: 100, type: "zone", description: "OSM-tagged 100 km/h trunk section on B1 near Migori. Limit: 100 km/h" },
  { id: "sz055", name: "B17 Nakuru–Marigat Highway", road: "B17 (Nakuru–Marigat)", lat: -0.0126, lng: 35.9644, speedLimit: 100, type: "zone", description: "OSM-tagged 100 km/h primary road — Nakuru to Marigat. Limit: 100 km/h" },
  { id: "sz056", name: "B18 Narok–Mau Narok–Njoro Zone", road: "B18 (Narok–Njoro)", lat: -0.7726, lng: 35.8958, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk road — Narok to Mau Narok to Njoro. Limit: 80 km/h" },

  // ── Eastern Kenya / Mt Kenya region (OSM maxspeed data) ──
  { id: "sz057", name: "A9 Embu–Siakago Highway", road: "A9 (Embu–Siakago)", lat: -1.0200, lng: 37.6855, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h trunk road — Embu to Siakago. Limit: 80 km/h" },
  { id: "sz058", name: "D490 Ruiri–Isiolo Road", road: "D490 (Ruiri–Isiolo)", lat: 0.2336, lng: 37.6128, speedLimit: 110, type: "zone", description: "Open semi-arid road — Ruiri to Isiolo. OSM-tagged high limit; drive to conditions. Limit: 110 km/h" },
  { id: "sz059", name: "Airport North Road Zone", road: "Airport North Road", lat: -1.3185, lng: 36.9150, speedLimit: 50, type: "zone", description: "OSM-tagged 50 km/h — Airport North Road near JKIA. Limit: 50 km/h" },

  // ── A8 Eldoret corridor (OSM maxspeed data) ──
  { id: "sz060", name: "A8 Eldoret–Nakuru Open Highway", road: "A8 (Eldoret–Nakuru)", lat: 0.4518, lng: 35.3069, speedLimit: 110, type: "zone", description: "OSM-tagged 110 km/h open highway — Eldoret to Nakuru. Limit: 110 km/h" },
  { id: "sz061", name: "A8 Eldoret–Nakuru Mid-Section", road: "A8 (Eldoret–Nakuru)", lat: 0.2433, lng: 35.4169, speedLimit: 80, type: "zone", description: "OSM-tagged 80 km/h section — built-up mid-route between Eldoret and Nakuru. Limit: 80 km/h" },
  { id: "sz062", name: "A8 Malaba Border – Open Highway", road: "A8 (Eldoret–Malaba)", lat: 0.5106, lng: 35.2928, speedLimit: 110, type: "zone", description: "OSM-tagged 110 km/h trunk — Eldoret to Malaba border. Limit: 110 km/h" },

  // ── Police checkpoint zones (sourced from OSM amenity=police near major corridors) ──
  { id: "sz063", name: "Langata Police Checkpoint Zone", road: "Lang'ata Road", lat: -1.3319, lng: 36.7820, speedLimit: 50, type: "police", description: "Langata Police Station — frequent radar stops on Langata Road. Limit: 50 km/h" },
  { id: "sz064", name: "Karen Police Checkpoint Zone", road: "Karen Road / Ngong Road", lat: -1.3218, lng: 36.7061, speedLimit: 50, type: "police", description: "Karen Police Station — residential speed checks. Limit: 50 km/h" },
  { id: "sz065", name: "Kilimani Police Checkpoint Zone", road: "Ngong Road", lat: -1.2918, lng: 36.7951, speedLimit: 80, type: "police", description: "Kilimani Divisional Police — radar on Ngong Road near Police Line. Limit: 80 km/h" },
  { id: "sz066", name: "Ngong Police Checkpoint", road: "Ngong Road", lat: -1.3654, lng: 36.6536, speedLimit: 50, type: "police", description: "Ngong Police Station — checkpoint at Ngong town entry. Limit: 50 km/h" },
  { id: "sz067", name: "Rongai / Bomas Police Check", road: "Magadi Road / Bomas", lat: -1.3971, lng: 36.7569, speedLimit: 50, type: "police", description: "Rongai Police — frequent checkpoint near Bomas of Kenya junction. Limit: 50 km/h" },
  { id: "sz068", name: "Muthaiga Police Checkpoint", road: "Thika Superhighway (A2)", lat: -1.2599, lng: 36.8429, speedLimit: 80, type: "police", description: "Muthaiga Police Station — radar stops near Thika Road Muthaiga junction. Limit: 80 km/h" },
  { id: "sz069", name: "Bamburi Police Checkpoint (Mombasa)", road: "A7 Malindi Road", lat: -3.9994, lng: 39.7276, speedLimit: 80, type: "police", description: "Bamburi Police — radar on Malindi Road north of Mombasa. Limit: 80 km/h" },
  { id: "sz070", name: "Diani Police Checkpoint (South Coast)", road: "Diani Beach Road", lat: -4.2829, lng: 39.5670, speedLimit: 50, type: "police", description: "Diani Police Station — checkpoint on South Coast road. Limit: 50 km/h" },
  { id: "sz071", name: "Nyali Police Checkpoint (Mombasa)", road: "A7 Nyali", lat: -4.0523, lng: 39.6931, speedLimit: 50, type: "police", description: "Nyali Police Station — speed checks near Nyali Bridge. Limit: 50 km/h" },
  { id: "sz072", name: "Kericho Police Checkpoint", road: "A12 / Kericho Town", lat: -0.3676, lng: 35.2874, speedLimit: 50, type: "police", description: "Kericho Police Station — checkpoint at town entry on A12. Limit: 50 km/h" },
  { id: "sz073", name: "Naivasha Police Checkpoint", road: "A104 (Nakuru Road)", lat: -0.7741, lng: 36.4266, speedLimit: 50, type: "police", description: "Police post on Nakuru road near Naivasha — regular speed checks. Limit: 50 km/h" },

  // --- Southern & Northern Bypass – additional points (NTSA city highway list) ---
  { id: "sz074", name: "Southern Bypass – Ngong Road Interchange", road: "Southern Bypass", lat: -1.3633, lng: 36.7375, speedLimit: 80, type: "camera", description: "NTSA-monitored interchange where the Southern Bypass meets Ngong Road. Limit: 80 km/h" },
  { id: "sz075", name: "Northern Bypass – Ruaka/Wangige Stretch", road: "Northern Bypass", lat: -1.2039, lng: 36.7806, speedLimit: 80, type: "camera", description: "NTSA-monitored stretch near Ruaka, on the Northern Bypass approach to Wangige. Limit: 80 km/h" },
];
