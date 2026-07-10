import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { getToken, getUser } from "@/lib/auth";

import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";
import Reports from "@/pages/reports";
import SpeedZones from "@/pages/speed-zones";
import Users from "@/pages/users";
import AuditLog from "@/pages/audit-log";
import Notifications from "@/pages/notifications";
import Subscribers from "@/pages/subscribers";
import PushCampaigns from "@/pages/push-campaigns";
import Releases from "@/pages/releases";
import Blog from "@/pages/blog";
import Creators from "@/pages/creators";

const queryClient = new QueryClient();

function ProtectedRoute({
  component: Component,
  adminOnly = false,
  adminOrModerator = false,
}: {
  component: any;
  adminOnly?: boolean;
  adminOrModerator?: boolean;
}) {
  const [, setLocation] = useLocation();
  const token = getToken();
  const user = getUser();

  useEffect(() => {
    if (!token || !user) {
      setLocation("/login");
    } else if (user.mustChangePassword) {
      setLocation("/change-password");
    } else if (adminOnly && user.role !== "admin") {
      setLocation(user.role === "moderator" ? "/reports" : "/reports");
    } else if (adminOrModerator && !["admin", "moderator"].includes(user.role)) {
      setLocation("/reports");
    }
  }, [token, user, setLocation, adminOnly, adminOrModerator]);

  if (!token || !user) return null;
  if (user.mustChangePassword) return null;
  if (adminOnly && user.role !== "admin") return null;
  if (adminOrModerator && !["admin", "moderator"].includes(user.role)) return null;

  return <Component />;
}

function RootRedirect() {
  const [, setLocation] = useLocation();
  const token = getToken();
  const user = getUser();

  useEffect(() => {
    if (token && user) {
      if (user.mustChangePassword) {
        setLocation("/change-password");
      } else {
        setLocation(user.role === "admin" ? "/dashboard" : "/reports");
      }
    } else {
      setLocation("/login");
    }
  }, [token, user, setLocation]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login" component={Login} />
      <Route path="/change-password" component={ChangePassword} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} adminOnly={true} /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
      <Route path="/speed-zones"><ProtectedRoute component={SpeedZones} /></Route>
      <Route path="/users"><ProtectedRoute component={Users} adminOnly={true} /></Route>
      <Route path="/audit-log"><ProtectedRoute component={AuditLog} adminOrModerator={true} /></Route>
      <Route path="/notifications"><ProtectedRoute component={Notifications} adminOrModerator={true} /></Route>
      <Route path="/subscribers"><ProtectedRoute component={Subscribers} adminOrModerator={true} /></Route>
      <Route path="/push-campaigns"><ProtectedRoute component={PushCampaigns} adminOrModerator={true} /></Route>
      <Route path="/releases"><ProtectedRoute component={Releases} adminOrModerator={true} /></Route>
      <Route path="/blog"><ProtectedRoute component={Blog} adminOrModerator={true} /></Route>
      <Route path="/creators"><ProtectedRoute component={Creators} adminOrModerator={true} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
