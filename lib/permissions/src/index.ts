// Single source of truth for admin feature keys, role defaults, and the
// effective-permission resolution logic. Shared by the API server
// (route-level enforcement) and the admin frontend (nav/route gating) so the
// two never drift apart.

export type AdminRole = "admin" | "moderator" | "staff";

export const FEATURE_GROUPS = [
  {
    group: "Content",
    features: [
      { key: "reports", label: "Incident Reports (view / edit / create)" },
      { key: "speed_zones", label: "Speed Zones (view / edit / create)" },
      { key: "blog", label: "Blog Management" },
      { key: "creators", label: "Creator Applications" },
    ],
  },
  {
    group: "Operations",
    features: [
      { key: "reports_bulk", label: "Bulk Report Actions" },
      { key: "reports_export", label: "Export Reports CSV" },
      { key: "push_campaigns", label: "Push Campaigns" },
      { key: "releases", label: "App Release Management" },
    ],
  },
  {
    group: "Management",
    features: [
      { key: "notifications", label: "Notifications" },
      { key: "subscribers", label: "Subscriber & Billing" },
      { key: "audit_log", label: "Audit Log" },
      { key: "dashboard", label: "Analytics Dashboard" },
      { key: "team", label: "Team Member Management" },
    ],
  },
] as const;

export const ALL_FEATURE_KEYS = FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.key));

export type FeatureKey = (typeof ALL_FEATURE_KEYS)[number];

export const ROLE_DEFAULTS: Record<AdminRole, FeatureKey[]> = {
  admin: [...ALL_FEATURE_KEYS],
  moderator: [
    "reports",
    "speed_zones",
    "blog",
    "creators",
    "reports_bulk",
    "reports_export",
    "push_campaigns",
    "releases",
    "notifications",
    "subscribers",
    "audit_log",
  ],
  staff: ["reports", "speed_zones"],
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (ALL_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Resolve the effective set of feature keys a user can access.
 * - If `permissions` (a custom grant list) is set, it wins outright —
 *   including for admins, so an admin's access can be intentionally
 *   narrowed by another admin.
 * - Otherwise, fall back to the role's default feature set.
 * Unknown/legacy roles get no default access; unrecognized feature keys in
 * a stored custom list are dropped so stale data can't grant access to a
 * feature that no longer exists.
 */
export function getEffectivePermissions(
  role: string,
  permissions: string[] | null | undefined
): FeatureKey[] {
  if (permissions) {
    return permissions.filter(isFeatureKey);
  }
  return ROLE_DEFAULTS[role as AdminRole] ?? [];
}

/**
 * The `admin_users.permissions` column stores a custom grant list as JSON
 * text (or is null/absent for "use role defaults"). Every call site that
 * reads it from the database must go through this parser rather than
 * casting the raw column value directly — it's a string, not an array.
 */
export function parseStoredPermissions(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasPermission(
  role: string,
  permissions: string[] | null | undefined,
  feature: FeatureKey
): boolean {
  return getEffectivePermissions(role, permissions).includes(feature);
}
