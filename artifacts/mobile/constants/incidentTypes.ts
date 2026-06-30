import type { ComponentProps } from "react";
import type { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

export type IncidentIconSet = "Ionicons" | "MaterialCommunityIcons";

export type IncidentTypeDef = {
  label: string;
  icon: string;
  iconSet: IncidentIconSet;
  color: string;
  emoji: string;
};

export const INCIDENT_TYPES: Record<string, IncidentTypeDef> = {
  camera:    { label: "Speed Camera",      icon: "camera",           iconSet: "Ionicons",               color: "#E53935", emoji: "📷"  },
  police:    { label: "Police Checkpoint", icon: "shield-checkmark", iconSet: "Ionicons",               color: "#1565C0", emoji: "🚔"  },
  accident:  { label: "Accident",          icon: "warning",          iconSet: "Ionicons",               color: "#B71C1C", emoji: "💥"  },
  traffic:   { label: "Traffic Jam",       icon: "traffic-light",    iconSet: "MaterialCommunityIcons", color: "#C62828", emoji: "🚦"  },
  roadblock: { label: "Roadblock",         icon: "construct",        iconSet: "Ionicons",               color: "#7B1FA2", emoji: "🚧"  },
  hazard:    { label: "Hazard",            icon: "flash",            iconSet: "Ionicons",               color: "#FF6F00", emoji: "⚠️"  },
  pothole:   { label: "Pothole",           icon: "remove-circle",    iconSet: "Ionicons",               color: "#F57C00", emoji: "🕳️" },
  debris:    { label: "Debris",            icon: "cube",             iconSet: "Ionicons",               color: "#795548", emoji: "🪨"  },
  breakdown: { label: "Broken Down",       icon: "car",              iconSet: "Ionicons",               color: "#FF8F00", emoji: "🚗"  },
  weather:   { label: "Bad Weather",       icon: "rainy",            iconSet: "Ionicons",               color: "#37474F", emoji: "🌧️" },
  closure:   { label: "Road Closed",       icon: "hand-left",        iconSet: "Ionicons",               color: "#880E4F", emoji: "🔴"  },
  clear:     { label: "Road Clear",        icon: "checkmark-circle", iconSet: "Ionicons",               color: "#00C853", emoji: "✅"  },
  __unknown: { label: "Unknown",           icon: "help-circle",      iconSet: "Ionicons",               color: "#546E7A", emoji: "❓"  },
};

export function resolveIncidentType(type: string): IncidentTypeDef {
  return INCIDENT_TYPES[type] ?? INCIDENT_TYPES.__unknown;
}

export const INCIDENT_TYPE_ORDER: (keyof typeof INCIDENT_TYPES)[] = [
  "camera", "police", "accident", "traffic", "roadblock",
  "hazard", "pothole", "debris", "breakdown", "weather", "closure", "clear",
];
