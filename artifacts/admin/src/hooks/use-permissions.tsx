import { createContext, useContext, type ReactNode } from "react";
import { useAdminGetMe } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import type { FeatureKey } from "@workspace/permissions";

interface PermissionsState {
  effectivePermissions: FeatureKey[];
  role: string | null;
  isLoading: boolean;
  can: (feature: FeatureKey) => boolean;
}

const PermissionsContext = createContext<PermissionsState>({
  effectivePermissions: [],
  role: null,
  isLoading: true,
  can: () => false,
});

// Fetches the caller's effective permissions fresh from the server (see
// GET /admin/auth/me) rather than relying on the — potentially days-old —
// role/permissions baked into the JWT. This is what lets a grant/revoke made
// in Team Members apply to an already-logged-in user without a re-login:
// the next time this query refetches, nav and route gating update.
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const hasToken = !!getToken();

  const { data, isLoading } = useAdminGetMe({
    query: {
      queryKey: ["/api/admin/auth/me"],
      enabled: hasToken,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  const effectivePermissions = (data?.effectivePermissions ?? []) as FeatureKey[];

  const value: PermissionsState = {
    effectivePermissions,
    role: data?.role ?? null,
    isLoading: hasToken && isLoading,
    can: (feature) => effectivePermissions.includes(feature),
  };

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
