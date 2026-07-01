import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ShieldAlert, LayoutDashboard, AlertTriangle, Gauge, Users, LogOut, Sun, Moon } from "lucide-react";
import { clearToken, getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const user = getUser();
  const { resolvedTheme, toggle } = useTheme();

  const handleLogout = () => {
    clearToken();
    setLocation("/login");
  };

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/reports", label: "Incidents", icon: AlertTriangle },
    { href: "/speed-zones", label: "Speed Zones", icon: Gauge },
  ];

  if (user?.role === 'admin') {
    navItems.push({ href: "/users", label: "Operators", icon: Users });
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row text-foreground selection:bg-primary/30">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-sidebar border-r border-sidebar-border flex flex-col flex-shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-sidebar-border">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <span className="font-mono font-bold tracking-wider uppercase text-lg text-sidebar-foreground">Msafiri</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${isActive ? "bg-sidebar-accent text-sidebar-accent-foreground border border-sidebar-accent-border font-medium" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"}`}>
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user?.name}</span>
              <span className="text-xs text-muted-foreground uppercase font-mono tracking-wider">{user?.role}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
