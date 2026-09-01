export const ROAD_CHANNEL_CATEGORY_TO_TYPE = {
  speed_camera: "camera",
  police_checkpoint: "police",
  alcoblow: "alcoblow",
  accident: "accident",
  traffic: "traffic",
  roadblock: "roadblock",
  roadworks: "roadworks",
  hazard: "hazard",
  speed_bump: "speed_bump",
  pothole: "pothole",
  debris: "debris",
  breakdown: "breakdown",
  bad_weather: "weather",
  road_closed: "closure",
  road_clear: "clear",
  other: "other",
} as const;

export function resolveRoadChannelCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ROAD_CHANNEL_CATEGORY_TO_TYPE[value as keyof typeof ROAD_CHANNEL_CATEGORY_TO_TYPE] ?? null;
}