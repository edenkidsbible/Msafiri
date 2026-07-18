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
import AppSettings from "@/pages/settings";

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
      <Route path="/settings"><ProtectedRoute component={AppSettings} feature="app_settings" /></Route>
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
