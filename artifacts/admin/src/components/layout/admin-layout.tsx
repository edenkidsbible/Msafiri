import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, AlertCircle, Gauge, Users, LogOut, Sun, Moon, Map } from "lucide-react";
import { clearToken, getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";

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
    { href: "/reports", label: "Incident Reports", icon: AlertCircle },
    { href: "/speed-zones", label: "Speed Zones", icon: Gauge },
  ];

  if (user?.role === 'admin') {
    navItems.push({ href: "/users", label: "Team Members", icon: Users });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background selection:bg-primary/20">
        <Sidebar variant="sidebar" className="border-r border-sidebar-border shadow-sm">
          <SidebarHeader className="p-4 flex flex-row items-center gap-3">
            <div className="bg-primary/10 text-primary p-2 rounded-lg">
              <Map className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">Msafiri Ops</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">SafeDrive</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs tracking-wider uppercase text-muted-foreground font-medium mb-2 px-4">
                Platform
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const isActive = location.startsWith(item.href);
                    return (
                      <SidebarMenuItem key={item.href} className="px-2">
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.label}
                          className="h-10"
                        >
                          <Link href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                            <item.icon className="h-4 w-4 mr-2" />
                            <span className="font-medium text-sm">{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-sidebar-border">
            <div className="flex items-center justify-between">
              <div className="flex flex-col overflow-hidden px-2">
                <span className="text-sm font-medium truncate text-foreground">{user?.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{user?.role}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggle}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                  data-testid="btn-toggle-theme"
                >
                  {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleLogout} 
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  data-testid="btn-logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="flex flex-col flex-1 bg-background min-w-0">
          <header className="h-14 border-b flex items-center px-4 md:hidden bg-background sticky top-0 z-10">
            <SidebarTrigger className="-ml-2" data-testid="btn-mobile-menu" />
            <div className="ml-2 font-semibold text-sm">Msafiri Ops</div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-8 animate-in fade-in duration-300">
            <div className="max-w-7xl mx-auto space-y-6">
              {children}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
