/**
 * Curated list of car makes and models popular in Kenya.
 * Images are served on-demand from Imagin.Studio's CDN using the make/model
 * slugs — no images need to be stored locally or in R2.
 *
 * Image URL pattern:
 *   https://cdn.imagin.studio/getimage
 *     ?customer=<EXPO_PUBLIC_IMAGIN_CUSTOMER|img>
 *     &make=<CarMake.id>
 *     &modelFamily=<CarModel.id>
 *     &zoomType=fullscreen
 *     &angle=29
 */

export interface CarMake {
  /** Imagin.Studio make slug (lowercase, hyphens). */
  id: string;
  /** Display name. */
  name: string;
  /** Emoji used as a fallback when no image is available. */
  emoji: string;
  models: CarModel[];
}

export interface CarModel {
  /** Imagin.Studio modelFamily slug (lowercase, hyphens). */
  id: string;
  /** Display name. */
  name: string;
}

/** Build a photorealistic car image URL via Imagin.Studio's CDN. */
export function getCarImageUrl(makeId: string, modelId: string): string {
  const customer = process.env.EXPO_PUBLIC_IMAGIN_CUSTOMER ?? "img";
  return (
    `https://cdn.imagin.studio/getimage` +
    `?customer=${customer}` +
    `&make=${encodeURIComponent(makeId)}` +
    `&modelFamily=${encodeURIComponent(modelId)}` +
    `&zoomType=fullscreen` +
    `&angle=29`
  );
}

export const CAR_MAKES: CarMake[] = [
  {
    id: "audi", name: "Audi", emoji: "🚗",
    models: [
      { id: "a3", name: "A3" },
      { id: "a4", name: "A4" },
      { id: "a6", name: "A6" },
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
    id: "ford", name: "Ford", emoji: "🚗",
    models: [
      { id: "ecosport", name: "EcoSport" },
      { id: "escape", name: "Escape" },
      { id: "explorer", name: "Explorer" },
      { id: "focus", name: "Focus" },
      { id: "fusion", name: "Fusion" },
      { id: "mustang", name: "Mustang" },
      { id: "ranger", name: "Ranger" },
    ],
  },
  {
    id: "honda", name: "Honda", emoji: "🚗",
    models: [
      { id: "accord", name: "Accord" },
      { id: "civic", name: "Civic" },
      { id: "cr-v", name: "CR-V" },
      { id: "fit", name: "Fit" },
      { id: "freed", name: "Freed" },
      { id: "hr-v", name: "HR-V" },
      { id: "jazz", name: "Jazz" },
      { id: "odyssey", name: "Odyssey" },
      { id: "pilot", name: "Pilot" },
      { id: "stepwgn", name: "Stepwgn" },
      { id: "stream", name: "Stream" },
      { id: "vezel", name: "Vezel" },
    ],
  },
  {
    id: "hyundai", name: "Hyundai", emoji: "🚗",
    models: [
      { id: "creta", name: "Creta" },
      { id: "elantra", name: "Elantra" },
      { id: "i10", name: "i10" },
      { id: "i20", name: "i20" },
      { id: "santa-fe", name: "Santa Fe" },
      { id: "sonata", name: "Sonata" },
      { id: "tucson", name: "Tucson" },
    ],
  },
  {
    id: "isuzu", name: "Isuzu", emoji: "🚗",
    models: [
      { id: "d-max", name: "D-Max" },
      { id: "mu-x", name: "MU-X" },
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
      { id: "picanto", name: "Picanto" },
      { id: "rio", name: "Rio" },
      { id: "sorento", name: "Sorento" },
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
    ],
  },
  {
    id: "lexus", name: "Lexus", emoji: "🚗",
    models: [
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
      { id: "cx-3", name: "CX-3" },
      { id: "cx-5", name: "CX-5" },
      { id: "demio", name: "Demio" },
      { id: "mpv", name: "MPV" },
      { id: "verisa", name: "Verisa" },
    ],
  },
  {
    id: "mercedes-benz", name: "Mercedes-Benz", emoji: "🚗",
    models: [
      { id: "a-class", name: "A-Class" },
      { id: "c-class", name: "C-Class" },
      { id: "e-class", name: "E-Class" },
      { id: "gle", name: "GLE" },
      { id: "glk", name: "GLK" },
      { id: "ml", name: "M-Class" },
      { id: "s-class", name: "S-Class" },
      { id: "vito", name: "Vito" },
    ],
  },
  {
    id: "mitsubishi", name: "Mitsubishi", emoji: "🚗",
    models: [
      { id: "colt", name: "Colt" },
      { id: "eclipse-cross", name: "Eclipse Cross" },
      { id: "galant", name: "Galant" },
      { id: "grandis", name: "Grandis" },
      { id: "l200", name: "L200" },
      { id: "lancer", name: "Lancer" },
      { id: "outlander", name: "Outlander" },
      { id: "pajero", name: "Pajero" },
      { id: "pajero-mini", name: "Pajero Mini" },
      { id: "pajero-sport", name: "Pajero Sport" },
      { id: "rvr", name: "RVR" },
    ],
  },
  {
    id: "nissan", name: "Nissan", emoji: "🚗",
    models: [
      { id: "bluebird", name: "Bluebird" },
      { id: "dualis", name: "Dualis" },
      { id: "elgrand", name: "Elgrand" },
      { id: "juke", name: "Juke" },
      { id: "kicks", name: "Kicks" },
      { id: "leaf", name: "Leaf" },
      { id: "march", name: "March" },
      { id: "micra", name: "Micra" },
      { id: "murano", name: "Murano" },
      { id: "navara", name: "Navara" },
      { id: "note", name: "Note" },
      { id: "patrol", name: "Patrol" },
      { id: "qashqai", name: "Qashqai" },
      { id: "serena", name: "Serena" },
      { id: "sunny", name: "Sunny" },
      { id: "tiida", name: "Tiida" },
      { id: "x-trail", name: "X-Trail" },
    ],
  },
  {
    id: "peugeot", name: "Peugeot", emoji: "🚗",
    models: [
      { id: "206", name: "206" },
      { id: "207", name: "207" },
      { id: "208", name: "208" },
      { id: "3008", name: "3008" },
      { id: "307", name: "307" },
      { id: "308", name: "308" },
      { id: "406", name: "406" },
      { id: "5008", name: "5008" },
      { id: "508", name: "508" },
    ],
  },
  {
    id: "subaru", name: "Subaru", emoji: "🚗",
    models: [
      { id: "forester", name: "Forester" },
      { id: "impreza", name: "Impreza" },
      { id: "legacy", name: "Legacy" },
      { id: "outback", name: "Outback" },
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
      { id: "ertiga", name: "Ertiga" },
      { id: "ignis", name: "Ignis" },
      { id: "jimny", name: "Jimny" },
      { id: "solio", name: "Solio" },
      { id: "swift", name: "Swift" },
      { id: "sx4", name: "SX4" },
      { id: "vitara", name: "Vitara" },
    ],
  },
  {
    id: "toyota", name: "Toyota", emoji: "🚗",
    models: [
      { id: "allion", name: "Allion" },
      { id: "alphard", name: "Alphard" },
      { id: "aqua", name: "Aqua" },
      { id: "avanza", name: "Avanza" },
      { id: "axio", name: "Axio" },
      { id: "c-hr", name: "C-HR" },
      { id: "camry", name: "Camry" },
      { id: "corolla", name: "Corolla" },
      { id: "fielder", name: "Fielder" },
      { id: "fortuner", name: "Fortuner" },
      { id: "harrier", name: "Harrier" },
      { id: "hiace", name: "Hiace" },
      { id: "hilux", name: "Hilux" },
      { id: "ist", name: "IST" },
      { id: "land-cruiser", name: "Land Cruiser" },
      { id: "land-cruiser-prado", name: "Land Cruiser Prado" },
      { id: "mark-x", name: "Mark X" },
      { id: "noah", name: "Noah" },
      { id: "premio", name: "Premio" },
      { id: "prius", name: "Prius" },
      { id: "probox", name: "Probox" },
      { id: "rav-4", name: "RAV4" },
      { id: "rush", name: "Rush" },
      { id: "succeed", name: "Succeed" },
      { id: "vanguard", name: "Vanguard" },
      { id: "vios", name: "Vios" },
      { id: "vitz", name: "Vitz" },
      { id: "wish", name: "Wish" },
      { id: "yaris", name: "Yaris" },
    ],
  },
  {
    id: "volkswagen", name: "Volkswagen", emoji: "🚗",
    models: [
      { id: "amarok", name: "Amarok" },
      { id: "golf", name: "Golf" },
      { id: "passat", name: "Passat" },
      { id: "polo", name: "Polo" },
      { id: "tiguan", name: "Tiguan" },
      { id: "touareg", name: "Touareg" },
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
