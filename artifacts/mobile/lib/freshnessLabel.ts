/**
 * Shared freshness / confidence helpers used in both the drive-overlay alerts
 * and the Report tab's nearby-reports list.
 */

export type ObservationContext =
  | "on_location"
  | "recent_nearby"
  | "community_tip"
  | undefined;

export type ConfidenceTier = "new" | "confirmed" | "reliable";

/** Maps confirm count → tier name. */
export function reportTier(confirmCount: number | undefined): ConfidenceTier {
  const c = confirmCount ?? 0;
  if (c >= 5) return "reliable";
  if (c >= 2) return "confirmed";
  return "new";
}

/** Human-readable age string for a report timestamp (epoch ms). */
export function ageLabel(createdAt: number | undefined): string {
  if (!createdAt) return "";
  const diffMs = Date.now() - createdAt;
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  if (mins < 2)   return "Just now";
  if (mins < 60)  return `${mins} min ago`;
  if (hours < 24) return `${hours}h ago`;
  return "Earlier today";
}

/**
 * Single-line freshness + confidence label.
 * Combines observation context, confirm count, and report age.
 */
export function freshnessLabel(
  confirmCount: number | undefined,
  createdAt: number | undefined,
  observationContext: ObservationContext,
): string {
  const c   = confirmCount ?? 0;
  const age = ageLabel(createdAt);

  if (observationContext === "community_tip") {
    return age ? `Community tip · ${age}` : "Community tip";
  }

  if (c === 0) return age ? `Reported ${age}` : "Reported by a driver";
  if (c < 5)   return age ? `${c > 1 ? `${c}× ` : ""}Confirmed · ${age}` : `Confirmed by ${c} driver${c === 1 ? "" : "s"}`;
  return age ? `Highly reliable · ${age}` : `Highly reliable · ${c} drivers`;
}

/**
 * Returns the chip colour trio (background, border, text) for a freshness chip.
 * Matches the drive-overlay palette so both surfaces feel consistent.
 */
export function freshnessChipColors(
  observationContext: ObservationContext,
  tier: ConfidenceTier,
): { bg: string; border: string; text: string } {
  if (observationContext === "community_tip") {
    return { bg: "#78350F22", border: "#D9770060", text: "#D97700" };
  }
  if (tier === "reliable") {
    return { bg: "#00C85318", border: "#00C85350", text: "#00A844" };
  }
  if (tier === "confirmed") {
    return { bg: "#FFD60018", border: "#FFD60050", text: "#B8960A" };
  }
  // "new" — neutral/muted
  return { bg: "transparent", border: "transparent", text: "" /* use mutedForeground */ };
}
