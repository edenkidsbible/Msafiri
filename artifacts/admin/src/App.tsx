import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { getToken, getUser } from "@/lib/auth";
import { PermissionsProvider, usePermissions } from "@/hooks/use-permissions";
import type { FeatureKey } from "@workspace/permissions";
import { getDefaultRoute } from "@/lib/permission-routes";
import { NoAccess } from "@/components/no-access";

import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";

// Ops platform pages (lazy-loaded to keep initial bundle small)
import { lazy, Suspense } from "react";
const OpsHome         = lazy(() => import("@/pages/ops/home"));
const OpsThisWeek     = lazy(() => import("@/pages/ops/this-week"));
const OpsMoney        = lazy(() => import("@/pages/ops/money"));
const OpsTasks        = lazy(() => import("@/pages/ops/tasks"));
const OpsContent      = lazy(() => import("@/pages/ops/content"));
const OpsField        = lazy(() => import("@/pages/ops/field"));
const OpsSubscriptions= lazy(() => import("@/pages/ops/subscriptions"));
const OpsTeam         = lazy(() => import("@/pages/ops/team"));
const OpsChat         = lazy(() => import("@/pages/ops/chat"));
const OpsImport       = lazy(() => import("@/pages/ops/import"));
const OpsSettings     = lazy(() => import("@/pages/ops/settings"));

function OpsRoute({ component: Component }: { component: React.ComponentType }) {
  const [, setLocation] = useLocation();
  const token = getToken();
  const user = getUser();
  useEffect(() => {
    if (!token || !user) setLocation("/login");
    else if (user.mustChangePassword) setLocation("/change-password");
  }, [token, user, setLocation]);
  if (!token || !user || user.mustChangePassword) return null;
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>}>
      <Component />
    </Suspense>
  );
}
import Reports from "@/pages/reports";
import ModerationQueue from "@/pages/moderation-queue";
import SpeedZones from "@/pages/speed-zones";
import Users from "@/pages/users";
import AuditLog from "@/pages/audit-log";
import Notifications from "@/pages/notifications";
import Subscribers from "@/pages/subscribers";
import PushCampaigns from "@/pages/push-campaigns";
import Releases from "@/pages/releases";
import Blog from "@/pages/blog";
import Creators from "@/pages/creators";
import Pois from "@/pages/pois";
import AppSettings from "@/pages/app-settings";
import DashcamDevices from "@/pages/dashcam-devices";
import SystemBackup from "@/pages/system-backup";
import InboxPage from "@/pages/inbox";
import VehicleClaims from "@/pages/vehicle-claims";

const queryClient = new QueryClient();

function ProtectedRoute({
  component: Component,
  feature,
}: {
  component: any;
  // Omit to mean "any authenticated user" (e.g. the moderation queue, which
  // rides along with the "reports" feature but has no distinct key of its
  // own — every role that can see Incident Reports can see this too).
  feature?: FeatureKey;
}) {
  const [, setLocation] = useLocation();
  const token = getToken();
  const user = getUser();
  const { effectivePermissions, isLoading } = usePermissions();

  const denied = !isLoading && !!feature && !effectivePermissions.includes(feature);
  // Only used once we know the current route is denied — points at the
  // first route the caller's *actual* permissions allow, never a hardcoded
  // guess, so a user with an unusual custom grant still lands somewhere
  // valid instead of bouncing into another denied route.
  const fallback = denied ? getDefaultRoute(effectivePermissions) : null;

  useEffect(() => {
    if (!token || !user) {
      setLocation("/login");
    } else if (user.mustChangePassword) {
      setLocation("/change-password");
    } else if (denied && fallback) {
      setLocation(fallback);
    }
  }, [token, user, setLocation, denied, fallback]);

  if (!token || !user) return null;
  if (user.mustChangePassword) return null;
  if (isLoading) return null;
  if (denied) return fallback ? null : <NoAccess />;

  return <Component />;
}

function RootRedirect() {
  const [, setLocation] = useLocation();
  const token = getToken();
  const user = getUser();
  const { effectivePermissions, isLoading } = usePermissions();

  useEffect(() => {
    if (!token || !user) {
      setLocation("/login");
      return;
    }
    if (user.mustChangePassword) {
      setLocation("/change-password");
      return;
    }
    if (isLoading) return;
    const fallback = getDefaultRoute(effectivePermissions);
    if (fallback) setLocation(fallback);
  }, [token, user, setLocation, isLoading, effectivePermissions]);

  if (!token || !user) return null;
  if (user.mustChangePassword) return null;
  if (isLoading) return null;
  if (!getDefaultRoute(effectivePermissions)) return <NoAccess />;

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login" component={Login} />
      <Route path="/change-password" component={ChangePassword} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} feature="dashboard" /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} feature="reports" /></Route>
      <Route path="/moderation-queue"><ProtectedRoute component={ModerationQueue} feature="reports" /></Route>
      <Route path="/speed-zones"><ProtectedRoute component={SpeedZones} feature="speed_zones" /></Route>
      <Route path="/users"><ProtectedRoute component={Users} feature="team" /></Route>
      <Route path="/audit-log"><ProtectedRoute component={AuditLog} feature="audit_log" /></Route>
      <Route path="/notifications"><ProtectedRoute component={Notifications} feature="notifications" /></Route>
      <Route path="/subscribers"><ProtectedRoute component={Subscribers} feature="subscribers" /></Route>
      <Route path="/push-campaigns"><ProtectedRoute component={PushCampaigns} feature="push_campaigns" /></Route>
      <Route path="/releases"><ProtectedRoute component={Releases} feature="releases" /></Route>
      <Route path="/blog"><ProtectedRoute component={Blog} feature="blog" /></Route>
      <Route path="/creators"><ProtectedRoute component={Creators} feature="creators" /></Route>
      <Route path="/pois"><ProtectedRoute component={Pois} feature="pois" /></Route>
      <Route path="/app-settings"><ProtectedRoute component={AppSettings} feature="app_settings" /></Route>
      <Route path="/dashcam-devices"><ProtectedRoute component={DashcamDevices} feature="dashboard" /></Route>
      <Route path="/system-backup"><ProtectedRoute component={SystemBackup} feature="app_settings" /></Route>
      <Route path="/inbox"><ProtectedRoute component={InboxPage} feature="inbox" /></Route>
      <Route path="/vehicle-claims"><ProtectedRoute component={VehicleClaims} feature="reports" /></Route>
      {/* Ops platform routes */}
      <Route path="/ops/home"><OpsRoute component={OpsHome} /></Route>
      <Route path="/ops/this-week"><OpsRoute component={OpsThisWeek} /></Route>
      <Route path="/ops/money"><OpsRoute component={OpsMoney} /></Route>
      <Route path="/ops/tasks"><OpsRoute component={OpsTasks} /></Route>
      <Route path="/ops/content"><OpsRoute component={OpsContent} /></Route>
      <Route path="/ops/field"><OpsRoute component={OpsField} /></Route>
      <Route path="/ops/subscriptions"><OpsRoute component={OpsSubscriptions} /></Route>
      <Route path="/ops/team"><OpsRoute component={OpsTeam} /></Route>
      <Route path="/ops/chat"><OpsRoute component={OpsChat} /></Route>
      <Route path="/ops/import"><OpsRoute component={OpsImport} /></Route>
      <Route path="/ops/settings"><OpsRoute component={OpsSettings} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <PermissionsProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </PermissionsProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
