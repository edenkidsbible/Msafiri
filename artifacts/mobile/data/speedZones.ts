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
];
