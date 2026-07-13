import type { FeatureKey } from "@workspace/permissions";

// Ordered by how central each area is to daily ops. When picking a landing
// page for a user (after login, at "/", or after being denied a route),
// walk this list and use the first feature the caller actually has —
// never assume "dashboard" or "reports" specifically, since a custom
// permission grant can omit either of those.
const ROUTE_FEATURE_PRIORITY: Array<{ feature: FeatureKey; href: string }> = [
  { feature: "dashboard", href: "/dashboard" },
  { feature: "reports", href: "/reports" },
  { feature: "speed_zones", href: "/speed-zones" },
  { feature: "notifications", href: "/notifications" },
  { feature: "subscribers", href: "/subscribers" },
  { feature: "audit_log", href: "/audit-log" },
  { feature: "push_campaigns", href: "/push-campaigns" },
  { feature: "releases", href: "/releases" },
  { feature: "blog", href: "/blog" },
  { feature: "creators", href: "/creators" },
  { feature: "team", href: "/users" },
];

/**
 * Returns the first route the caller's effective permissions actually grant
 * access to, or null if they have no accessible feature at all (an
 * account with every permission explicitly revoked).
 */
export function getDefaultRoute(effectivePermissions: FeatureKey[]): string | null {
  const match = ROUTE_FEATURE_PRIORITY.find((r) => effectivePermissions.includes(r.feature));
  return match?.href ?? null;
}
