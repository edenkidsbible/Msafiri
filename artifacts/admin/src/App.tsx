import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { getToken, getUser } from "@/lib/auth";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Reports from "@/pages/reports";
import Users from "@/pages/users";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, adminOnly = false }: { component: any, adminOnly?: boolean }) {
  const [, setLocation] = useLocation();
  const token = getToken();
  const user = getUser();

  useEffect(() => {
    if (!token || !user) {
      setLocation("/login");
    } else if (adminOnly && user.role !== 'admin') {
      setLocation("/dashboard");
    }
  }, [token, user, setLocation, adminOnly]);

  if (!token || !user) return null;
  if (adminOnly && user.role !== 'admin') return null;
  
  return <Component />;
}

function RootRedirect() {
  const [, setLocation] = useLocation();
  const token = getToken();
  
  useEffect(() => {
    if (token) {
      setLocation("/dashboard");
    } else {
      setLocation("/login");
    }
  }, [token, setLocation]);
  
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
      <Route path="/users"><ProtectedRoute component={Users} adminOnly={true} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
