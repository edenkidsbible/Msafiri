import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldOff, Loader2 } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function authFetch(path: string, options?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ reviewerModeEnabled: boolean }>({
    queryKey: ["/api/admin/settings"],
    queryFn: () => authFetch("/api/admin/settings"),
  });

  const mutation = useMutation({
    mutationFn: (enabled: boolean) =>
      authFetch("/api/admin/settings/reviewer-mode", {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (updated: { reviewerModeEnabled: boolean }) => {
      qc.setQueryData(["/api/admin/settings"], updated);
      toast({
        title: updated.reviewerModeEnabled ? "Reviewer Mode Enabled" : "Reviewer Mode Disabled",
        description: updated.reviewerModeEnabled
          ? "Store reviewers can now tap the logo 4 times to bypass the paywall."
          : "Paywall restored. The reviewer bypass is deactivated for all devices.",
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update setting.", variant: "destructive" });
    },
  });

  const reviewerModeEnabled = data?.reviewerModeEnabled ?? false;

  return (
    <AdminLayout>
      <div className="p-6 max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">App Settings</h1>
          <p className="text-muted-foreground mt-1">
            Global configuration flags for the Msafiri mobile app.
          </p>
        </div>

        <Card className={reviewerModeEnabled ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/20" : ""}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldOff className="w-4 h-4 shrink-0" />
                  Store Reviewer Bypass
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  ) : reviewerModeEnabled ? (
                    <Badge
                      variant="outline"
                      className="text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-[10px] font-bold tracking-wide"
                    >
                      ACTIVE
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription className="mt-1.5">
                  When enabled, store reviewers can tap the <strong>Msafiri logo 4 times</strong> on
                  the paywall screen to unlock the full app without a subscription. Disable this
                  once your review is approved.
                </CardDescription>
              </div>
              <Switch
                checked={reviewerModeEnabled}
                onCheckedChange={(v) => mutation.mutate(v)}
                disabled={isLoading || mutation.isPending}
                className="shrink-0 mt-1"
              />
            </div>
          </CardHeader>

          {reviewerModeEnabled && (
            <CardContent className="pt-0">
              <div className="flex items-start gap-3 rounded-lg bg-amber-100/80 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
                  The reviewer bypass is <strong>active</strong>. Any device can tap the paywall logo
                  4 times to unlock full app access. Disable this as soon as your store review is approved.
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}
