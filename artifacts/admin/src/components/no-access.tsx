import { clearToken } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ShieldOff } from "lucide-react";

// Shown when a signed-in account has no accessible feature at all (every
// permission explicitly revoked). We deliberately don't redirect anywhere
// here — every candidate destination would itself deny the user, which
// would otherwise loop.
export function NoAccess() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center bg-muted/30">
      <ShieldOff className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">No access assigned</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your account doesn't have permission to view any section yet. Ask an administrator to grant you access.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          clearToken();
          setLocation("/login");
        }}
        data-testid="btn-logout-no-access"
      >
        Sign out
      </Button>
    </div>
  );
}
