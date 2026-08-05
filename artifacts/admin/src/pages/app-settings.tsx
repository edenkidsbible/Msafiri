import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAdminGetSettings, useAdminUpdateSettings } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Navigation, MapPin } from "lucide-react";

export default function AppSettings() {
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useAdminGetSettings({
    query: { queryKey: ["admin-settings"] },
  });

  const { mutate: updateSettings, isPending } = useAdminUpdateSettings({
    mutation: {
      onSuccess: () => {
        refetch();
        toast({ title: "Settings saved", description: "App settings updated successfully." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
      },
    },
  });

  const handleNavigationToggle = (enabled: boolean) => {
    updateSettings({ data: { navigationEnabled: enabled } });
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">App Settings</h1>
            <p className="text-muted-foreground">Control feature availability in the mobile app.</p>
          </div>
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </AdminLayout>
    );
  }

  if (isError) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex flex-col gap-1 border-b pb-6">
            <h1 className="text-3xl font-bold tracking-tight">App Settings</h1>
            <p className="text-muted-foreground">Control feature availability in the mobile app.</p>
          </div>
          <p className="text-destructive text-sm">Failed to load settings. Please refresh.</p>
        </div>
      </AdminLayout>
    );
  }

  const navigationEnabled = data?.navigationEnabled ?? true;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-1 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight">App Settings</h1>
          <p className="text-muted-foreground">
            Control feature availability in the Msafiri Kenya mobile app. Changes take effect immediately — the app
            picks up the new settings on its next foreground refresh.
          </p>
        </div>

        {/* Navigation Feature */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Navigation className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Turn-by-Turn Navigation</CardTitle>
                <CardDescription>
                  Allow users to search for destinations, plan routes, and receive voice-guided navigation.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="nav-toggle" className="text-base font-medium">
                  Navigation feature
                </Label>
                <p className="text-sm text-muted-foreground">
                  {navigationEnabled
                    ? "Active — users can search destinations and navigate."
                    : "Off — search bar shows places only; no routing or voice guidance."}
                </p>
              </div>
              <Switch
                id="nav-toggle"
                checked={navigationEnabled}
                onCheckedChange={handleNavigationToggle}
                disabled={isPending}
                aria-label="Toggle navigation feature"
              />
            </div>

            {!navigationEnabled && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  With navigation off, the "Where to?" search bar becomes a places explorer — users can still search
                  for locations and have them highlighted on the map, but route planning and voice guidance are
                  disabled.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
