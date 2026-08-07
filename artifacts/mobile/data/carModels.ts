import { API_BASE } from "@/utils/apiClient";

export interface CarMake {
  /** Slug (lowercase, hyphens) — also the R2 key path segment. */
  id: string;
  /** Display name. */
  name: string;
  /** Emoji used as a fallback when no image is available. */
  emoji: string;
  models: CarModel[];
}

export interface CarModel {
  /** Slug (lowercase, hyphens) — also the R2 key path segment. */
  id: string;
  /** Display name. */
  name: string;
}

/** URL of the studio car image served from R2 via the API server. */
export function getCarImageUrl(makeId: string, modelId: string): string {
  return `${API_BASE}/car-images/${encodeURIComponent(makeId)}/${encodeURIComponent(modelId)}`;
}

export const CAR_MAKES: CarMake[] = [
  {
    id: "audi", name: "Audi", emoji: "🚗",
    models: [
      { id: "a3", name: "A3" },
      { id: "a4", name: "A4" },
      { id: "a5", name: "A5" },
      { id: "a6", name: "A6" },
      { id: "q2", name: "Q2" },
      { id: "q3", name: "Q3" },
      { id: "q5", name: "Q5" },
      { id: "q7", name: "Q7" },
    ],
  },
  {
    id: "bmw", name: "BMW", emoji: "🚗",
    models: [
      { id: "1-series", name: "1 Series" },
      { id: "2-series", name: "2 Series" },
      { id: "3-series", name: "3 Series" },
      { id: "5-series", name: "5 Series" },
      { id: "7-series", name: "7 Series" },
      { id: "x1", name: "X1" },
      { id: "x3", name: "X3" },
      { id: "x5", name: "X5" },
      { id: "x6", name: "X6" },
    ],
  },
  {
    id: "chevrolet", name: "Chevrolet", emoji: "🚗",
    models: [
      { id: "aveo", name: "Aveo" },
      { id: "captiva", name: "Captiva" },
      { id: "cruze", name: "Cruze" },
      { id: "trailblazer", name: "Trailblazer" },
    ],
  },
  {
    id: "daihatsu", name: "Daihatsu", emoji: "🚗",
    models: [
      { id: "hijet", name: "Hijet" },
      { id: "mira", name: "Mira" },
      { id: "rocky", name: "Rocky" },
      { id: "terios", name: "Terios" },
    ],
  },
  {
    id: "ford", name: "Ford", emoji: "🚗",
    models: [
      { id: "ecosport", name: "EcoSport" },
      { id: "escape", name: "Escape" },
      { id: "everest", name: "Everest" },
      { id: "explorer", name: "Explorer" },
      { id: "focus", name: "Focus" },
      { id: "fusion", name: "Fusion" },
      { id: "kuga", name: "Kuga" },
      { id: "mustang", name: "Mustang" },
      { id: "ranger", name: "Ranger" },
    ],
  },
  {
    id: "honda", name: "Honda", emoji: "🚗",
    models: [
      { id: "accord", name: "Accord" },
      { id: "airwave", name: "Airwave" },
      { id: "civic", name: "Civic" },
      { id: "cr-v", name: "CR-V" },
      { id: "fit", name: "Fit" },
      { id: "freed", name: "Freed" },
      { id: "grace", name: "Grace" },
      { id: "hr-v", name: "HR-V" },
      { id: "insight", name: "Insight" },
      { id: "jazz", name: "Jazz" },
      { id: "odyssey", name: "Odyssey" },
      { id: "pilot", name: "Pilot" },
      { id: "shuttle", name: "Shuttle" },
      { id: "stepwgn", name: "Stepwgn" },
      { id: "stream", name: "Stream" },
      { id: "vezel", name: "Vezel" },
    ],
  },
  {
    id: "hyundai", name: "Hyundai", emoji: "🚗",
    models: [
      { id: "accent", name: "Accent" },
      { id: "creta", name: "Creta" },
      { id: "elantra", name: "Elantra" },
      { id: "i10", name: "i10" },
      { id: "i20", name: "i20" },
      { id: "kona", name: "Kona" },
      { id: "santa-fe", name: "Santa Fe" },
      { id: "sonata", name: "Sonata" },
      { id: "tucson", name: "Tucson" },
      { id: "venue", name: "Venue" },
    ],
  },
  {
    id: "isuzu", name: "Isuzu", emoji: "🚗",
    models: [
      { id: "d-max", name: "D-Max" },
      { id: "frr", name: "FRR" },
      { id: "mu-x", name: "MU-X" },
      { id: "npr", name: "NPR" },
      { id: "nqr", name: "NQR" },
      { id: "trooper", name: "Trooper" },
    ],
  },
  {
    id: "jaguar", name: "Jaguar", emoji: "🚗",
    models: [
      { id: "f-pace", name: "F-Pace" },
      { id: "xe", name: "XE" },
      { id: "xf", name: "XF" },
    ],
  },
  {
    id: "jeep", name: "Jeep", emoji: "🚙",
    models: [
      { id: "cherokee", name: "Cherokee" },
      { id: "compass", name: "Compass" },
      { id: "grand-cherokee", name: "Grand Cherokee" },
      { id: "renegade", name: "Renegade" },
      { id: "wrangler", name: "Wrangler" },
    ],
  },
  {
    id: "kia", name: "Kia", emoji: "🚗",
    models: [
      { id: "carnival", name: "Carnival" },
      { id: "cerato", name: "Cerato" },
      { id: "picanto", name: "Picanto" },
      { id: "rio", name: "Rio" },
      { id: "seltos", name: "Seltos" },
      { id: "sorento", name: "Sorento" },
      { id: "soul", name: "Soul" },
      { id: "sportage", name: "Sportage" },
      { id: "stinger", name: "Stinger" },
    ],
  },
  {
    id: "land-rover", name: "Land Rover", emoji: "🚙",
    models: [
      { id: "defender", name: "Defender" },
      { id: "discovery", name: "Discovery" },
      { id: "discovery-sport", name: "Discovery Sport" },
      { id: "freelander", name: "Freelander" },
      { id: "range-rover", name: "Range Rover" },
      { id: "range-rover-evoque", name: "Range Rover Evoque" },
      { id: "range-rover-sport", name: "Range Rover Sport" },
      { id: "range-rover-velar", name: "Range Rover Velar" },
    ],
  },
  {
    id: "lexus", name: "Lexus", emoji: "🚗",
    models: [
      { id: "ct", name: "CT" },
      { id: "es", name: "ES" },
      { id: "gx", name: "GX" },
      { id: "is", name: "IS" },
      { id: "lx", name: "LX" },
      { id: "nx", name: "NX" },
      { id: "rx", name: "RX" },
      { id: "ux", name: "UX" },
    ],
  },
  {
    id: "mazda", name: "Mazda", emoji: "🚗",
    models: [
      { id: "atenza", name: "Atenza" },
      { id: "axela", name: "Axela" },
      { id: "biante", name: "Biante" },
      { id: "bongo", name: "Bongo" },
      { id: "bt-50", name: "BT-50" },
      { id: "carol", name: "Carol" },
      { id: "cx-3", name: "CX-3" },
      { id: "cx-30", name: "CX-30" },
      { id: "cx-5", name: "CX-5" },
      { id: "cx-8", name: "CX-8" },
      { id: "demio", name: "Demio" },
      { id: "mpv", name: "MPV" },
      { id: "premacy", name: "Premacy" },
      { id: "verisa", name: "Verisa" },
    ],
  },
  {
    id: "mercedes-benz", name: "Mercedes-Benz", emoji: "🚗",
    models: [
      { id: "a-class", name: "A-Class" },
      { id: "b-class", name: "B-Class" },
      { id: "c-class", name: "C-Class" },
      { id: "cla", name: "CLA" },
      { id: "e-class", name: "E-Class" },
      { id: "gla", name: "GLA" },
      { id: "glc", name: "GLC" },
      { id: "gle", name: "GLE" },
      { id: "glk", name: "GLK" },
      { id: "ml", name: "M-Class" },
      { id: "s-class", name: "S-Class" },
      { id: "sprinter", name: "Sprinter" },
      { id: "vito", name: "Vito" },
    ],
  },
  {
    id: "mitsubishi", name: "Mitsubishi", emoji: "🚗",
    models: [
      { id: "asx", name: "ASX" },
      { id: "attrage", name: "Attrage" },
      { id: "canter", name: "Canter" },
      { id: "colt", name: "Colt" },
      { id: "delica", name: "Delica" },
      { id: "eclipse-cross", name: "Eclipse Cross" },
      { id: "fuso-fighter", name: "Fuso Fighter" },
      { id: "galant", name: "Galant" },
      { id: "grandis", name: "Grandis" },
      { id: "l200", name: "L200" },
      { id: "lancer", name: "Lancer" },
      { id: "mirage", name: "Mirage" },
      { id: "outlander", name: "Outlander" },
      { id: "pajero", name: "Pajero" },
      { id: "pajero-mini", name: "Pajero Mini" },
      { id: "pajero-sport", name: "Pajero Sport" },
      { id: "rvr", name: "RVR" },
      { id: "shogun", name: "Shogun" },
    ],
  },
  {
    id: "nissan", name: "Nissan", emoji: "🚗",
    models: [
      { id: "ad-van", name: "AD Van" },
      { id: "bluebird", name: "Bluebird" },
      { id: "caravan", name: "Caravan" },
      { id: "cube", name: "Cube" },
      { id: "dualis", name: "Dualis" },
      { id: "elgrand", name: "Elgrand" },
      { id: "juke", name: "Juke" },
      { id: "kicks", name: "Kicks" },
      { id: "lafesta", name: "Lafesta" },
      { id: "latio", name: "Latio" },
      { id: "leaf", name: "Leaf" },
      { id: "march", name: "March" },
      { id: "micra", name: "Micra" },
      { id: "murano", name: "Murano" },
      { id: "navara", name: "Navara" },
      { id: "note", name: "Note" },
      { id: "nv200", name: "NV200" },
      { id: "nv350", name: "NV350" },
      { id: "patrol", name: "Patrol" },
      { id: "qashqai", name: "Qashqai" },
      { id: "serena", name: "Serena" },
      { id: "sunny", name: "Sunny" },
      { id: "sylphy", name: "Sylphy" },
      { id: "teana", name: "Teana" },
      { id: "tiida", name: "Tiida" },
      { id: "wingroad", name: "Wingroad" },
      { id: "x-trail", name: "X-Trail" },
    ],
  },
  {
    id: "peugeot", name: "Peugeot", emoji: "🚗",
    models: [
      { id: "2008", name: "2008" },
      { id: "206", name: "206" },
      { id: "207", name: "207" },
      { id: "208", name: "208" },
      { id: "3008", name: "3008" },
      { id: "307", name: "307" },
      { id: "308", name: "308" },
      { id: "406", name: "406" },
      { id: "5008", name: "5008" },
      { id: "504", name: "504" },
      { id: "508", name: "508" },
      { id: "partner", name: "Partner" },
    ],
  },
  {
    id: "porsche", name: "Porsche", emoji: "🚗",
    models: [
      { id: "cayenne", name: "Cayenne" },
      { id: "macan", name: "Macan" },
      { id: "panamera", name: "Panamera" },
    ],
  },
  {
    id: "renault", name: "Renault", emoji: "🚗",
    models: [
      { id: "duster", name: "Duster" },
      { id: "kwid", name: "Kwid" },
      { id: "megane", name: "Megane" },
    ],
  },
  {
    id: "subaru", name: "Subaru", emoji: "🚗",
    models: [
      { id: "crosstrek", name: "Crosstrek" },
      { id: "exiga", name: "Exiga" },
      { id: "forester", name: "Forester" },
      { id: "impreza", name: "Impreza" },
      { id: "legacy", name: "Legacy" },
      { id: "levorg", name: "Levorg" },
      { id: "outback", name: "Outback" },
      { id: "trezia", name: "Trezia" },
      { id: "tribeca", name: "Tribeca" },
      { id: "wrx", name: "WRX" },
      { id: "xv", name: "XV" },
    ],
  },
  {
    id: "suzuki", name: "Suzuki", emoji: "🚗",
    models: [
      { id: "alto", name: "Alto" },
      { id: "baleno", name: "Baleno" },
      { id: "celerio", name: "Celerio" },
      { id: "ertiga", name: "Ertiga" },
      { id: "escudo", name: "Escudo" },
      { id: "every", name: "Every" },
      { id: "hustler", name: "Hustler" },
      { id: "ignis", name: "Ignis" },
      { id: "jimny", name: "Jimny" },
      { id: "solio", name: "Solio" },
      { id: "swift", name: "Swift" },
      { id: "sx4", name: "SX4" },
      { id: "vitara", name: "Vitara" },
      { id: "wagon-r", name: "Wagon R" },
    ],
  },
  {
    id: "toyota", name: "Toyota", emoji: "🚗",
    models: [
      { id: "allion", name: "Allion" },
      { id: "alphard", name: "Alphard" },
      { id: "aqua", name: "Aqua" },
      { id: "auris", name: "Auris" },
      { id: "avanza", name: "Avanza" },
      { id: "avensis", name: "Avensis" },
      { id: "axio", name: "Axio" },
      { id: "belta", name: "Belta" },
      { id: "c-hr", name: "C-HR" },
      { id: "camry", name: "Camry" },
      { id: "coaster", name: "Coaster" },
      { id: "corolla", name: "Corolla" },
      { id: "corolla-cross", name: "Corolla Cross" },
      { id: "crown", name: "Crown" },
      { id: "dyna", name: "Dyna" },
      { id: "estima", name: "Estima" },
      { id: "fielder", name: "Fielder" },
      { id: "fj-cruiser", name: "FJ Cruiser" },
      { id: "fortuner", name: "Fortuner" },
      { id: "harrier", name: "Harrier" },
      { id: "hiace", name: "Hiace" },
      { id: "hilux", name: "Hilux" },
      { id: "isis", name: "Isis" },
      { id: "ist", name: "IST" },
      { id: "land-cruiser", name: "Land Cruiser" },
      { id: "land-cruiser-70", name: "Land Cruiser 70" },
      { id: "land-cruiser-prado", name: "Land Cruiser Prado" },
      { id: "mark-x", name: "Mark X" },
      { id: "noah", name: "Noah" },
      { id: "passo", name: "Passo" },
      { id: "platz", name: "Platz" },
      { id: "porte", name: "Porte" },
      { id: "premio", name: "Premio" },
      { id: "prius", name: "Prius" },
      { id: "probox", name: "Probox" },
      { id: "ractis", name: "Ractis" },
      { id: "raize", name: "Raize" },
      { id: "rav-4", name: "RAV4" },
      { id: "rush", name: "Rush" },
      { id: "sienta", name: "Sienta" },
      { id: "spacio", name: "Spacio" },
      { id: "succeed", name: "Succeed" },
      { id: "townace", name: "TownAce" },
      { id: "vanguard", name: "Vanguard" },
      { id: "vellfire", name: "Vellfire" },
      { id: "vios", name: "Vios" },
      { id: "vitz", name: "Vitz" },
      { id: "voxy", name: "Voxy" },
      { id: "wish", name: "Wish" },
      { id: "yaris", name: "Yaris" },
      { id: "yaris-cross", name: "Yaris Cross" },
    ],
  },
  {
    id: "volkswagen", name: "Volkswagen", emoji: "🚗",
    models: [
      { id: "amarok", name: "Amarok" },
      { id: "caddy", name: "Caddy" },
      { id: "golf", name: "Golf" },
      { id: "jetta", name: "Jetta" },
      { id: "passat", name: "Passat" },
      { id: "polo", name: "Polo" },
      { id: "t-cross", name: "T-Cross" },
      { id: "tiguan", name: "Tiguan" },
      { id: "touareg", name: "Touareg" },
      { id: "touran", name: "Touran" },
    ],
  },
  {
    id: "volvo", name: "Volvo", emoji: "🚗",
    models: [
      { id: "s60", name: "S60" },
      { id: "s90", name: "S90" },
      { id: "v40", name: "V40" },
      { id: "v60", name: "V60" },
      { id: "xc40", name: "XC40" },
      { id: "xc60", name: "XC60" },
      { id: "xc90", name: "XC90" },
    ],
  },
];

/** Makes sorted A→Z — use this for the picker UI. */
export const SORTED_MAKES = [...CAR_MAKES].sort((a, b) =>
  a.name.localeCompare(b.name),
);

/** Look up a make by its id. */
export function getMakeById(id: string): CarMake | undefined {
  return CAR_MAKES.find((m) => m.id === id);
}

/** Look up a model within a make. */
export function getModelById(makeId: string, modelId: string): CarModel | undefined {
  return getMakeById(makeId)?.models.find((m) => m.id === modelId);
}

/** Models of a make sorted A→Z — use this for the picker UI. */
export function sortedModels(make: CarMake): CarModel[] {
  return [...make.models].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
