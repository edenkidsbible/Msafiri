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
  { id: "sz035", name: "Mombasa Road – Nyayo Stadium to Sameer Park Zone", road: "Mombasa Road (A109)", lat: -1.3100, lng: 36.8253, speedLimit: 80, type: "zone", description: "Speed zone between Nyayo Stadium and Sameer Business Park. Limit: 80 km/h" },
  { id: "sz036", name: "Mombasa Road – Cabanas/JKIA Camera", road: "Mombasa Road (A109)", lat: -1.3264, lng: 36.9142, speedLimit: 80, type: "camera", description: "Fixed ANPR camera at Cabanas near JKIA junction. Limit: 80 km/h" },

  // --- Waiyaki Way – additional zone ---
  { id: "sz037", name: "Waiyaki Way – Kangemi to Uthiru Zone", road: "Waiyaki Way", lat: -1.2664, lng: 36.7447, speedLimit: 60, type: "zone", description: "Built-up area speed zone from Kangemi to Uthiru. Limit: 60 km/h" },

  // --- A2 Highway – Nairobi–Nyeri corridor town zones ---
  { id: "sz038", name: "Kenol Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.9136, lng: 37.0708, speedLimit: 50, type: "zone", description: "Built-up area limit through Kenol town. Limit: 50 km/h" },
  { id: "sz039", name: "Makuyu Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.8803, lng: 37.0989, speedLimit: 50, type: "zone", description: "Built-up area limit through Makuyu town. Limit: 50 km/h" },
  { id: "sz040", name: "Sagana Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.6711, lng: 37.2103, speedLimit: 50, type: "zone", description: "Built-up area limit through Sagana town. Limit: 50 km/h" },
  { id: "sz041", name: "Karatina Town Speed Zone", road: "A2 Highway (Nairobi–Nyeri)", lat: -0.4808, lng: 37.1247, speedLimit: 50, type: "zone", description: "Built-up area limit through Karatina town. Limit: 50 km/h" },
  { id: "sz042", name: "Kanyonyo Weighbridge – Speed Camera", road: "Machakos–Matuu Road (C80)", lat: -1.3620, lng: 37.3970, speedLimit: 50, type: "camera", description: "Fixed speed camera at Kanyonyo weighbridge on the Machakos–Matuu stretch. Limit: 50 km/h" },
];
