import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, AlertCircle, Gauge, Users, LogOut, Sun, Moon, ClipboardList, Bell, CreditCard, Megaphone, Rocket, FileText, KeyRound, Star, ShieldCheck, Search, Settings } from "lucide-react";
import logo from "@/assets/logo.png";
import { clearToken, getUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { useAdminListNotifications } from "@workspace/api-client-react";
import { GlobalSearch } from "@/components/global-search";
import { usePermissions } from "@/hooks/use-permissions";
import type { FeatureKey } from "@workspace/permissions";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const { can } = usePermissions();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const { data: notifData } = useAdminListNotifications({
    query: {
      queryKey: ["/api/admin/notifications"],
      refetchInterval: 30000,
      enabled: can("notifications"),
    },
  });

  const unreadCount = notifData?.unreadCount ?? 0;

  const handleLogout = () => {
    clearToken();
    setLocation("/login");
  };

  const coreNavAll: Array<{ href: string; label: string; icon: typeof AlertCircle; feature: FeatureKey }> = [
    { href: "/reports",            label: "Incident Reports",  icon: AlertCircle,  feature: "reports" },
    { href: "/moderation-queue",   label: "Moderation Queue",  icon: ShieldCheck,  feature: "reports" },
    { href: "/speed-zones",        label: "Speed Zones",       icon: Gauge,        feature: "speed_zones" },
  ];
  const coreNav = coreNavAll.filter((item) => can(item.feature));

  const moderatorNavAll: Array<{ href: string; label: string; icon: typeof Bell; feature: FeatureKey }> = [
    { href: "/notifications",  label: "Notifications",    icon: Bell,          feature: "notifications" },
    { href: "/push-campaigns", label: "Push Campaigns",   icon: Megaphone,     feature: "push_campaigns" },
    { href: "/releases",       label: "App Releases",     icon: Rocket,        feature: "releases" },
    { href: "/blog",           label: "Blog Posts",       icon: FileText,      feature: "blog" },
    { href: "/audit-log",      label: "Activity Log",     icon: ClipboardList, feature: "audit_log" },
    { href: "/subscribers",    label: "Subscribers",      icon: CreditCard,    feature: "subscribers" },
    { href: "/creators",       label: "Creators",         icon: Star,          feature: "creators" },
  ];
  const moderatorNav = moderatorNavAll.filter((item) => can(item.feature));

  const adminOnlyNavAll: Array<{ href: string; label: string; icon: typeof LayoutDashboard; feature: FeatureKey }> = [
    { href: "/dashboard", label: "Dashboard",    icon: LayoutDashboard, feature: "dashboard" },
    { href: "/users",     label: "Team Members", icon: Users,           feature: "team" },
    { href: "/settings",  label: "App Settings", icon: Settings,        feature: "app_settings" },
  ];
  const adminOnlyNav = adminOnlyNavAll.filter((item) => can(item.feature));

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background selection:bg-primary/20">
        <Sidebar variant="sidebar" className="border-r border-sidebar-border shadow-sm">
          <SidebarHeader className="p-4 flex flex-row items-center gap-3">
            <div className="bg-primary/10 text-primary p-1.5 rounded-lg">
              <img src={logo} alt="Msafiri" className="h-6 w-6" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">Msafiri Ops</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Kenya</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {adminOnlyNav.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-xs tracking-wider uppercase text-muted-foreground font-medium mb-2 px-4">
                  Overview
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {adminOnlyNav.map((item) => {
                      const isActive = location.startsWith(item.href);
                      return (
                        <SidebarMenuItem key={item.href} className="px-2">
                          <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} className="h-10">
                            <Link href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
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
            )}

            <SidebarGroup>
              <SidebarGroupLabel className="text-xs tracking-wider uppercase text-muted-foreground font-medium mb-2 px-4">
                Platform
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {coreNav.map((item) => {
                    const isActive = location.startsWith(item.href);
                    return (
                      <SidebarMenuItem key={item.href} className="px-2">
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} className="h-10">
                          <Link href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
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

            {moderatorNav.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="text-xs tracking-wider uppercase text-muted-foreground font-medium mb-2 px-4">
                  Operations
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {moderatorNav.map((item) => {
                      const isActive = location.startsWith(item.href);
                      return (
                        <SidebarMenuItem key={item.href} className="px-2">
                          <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} className="h-10">
                            <Link href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                              <item.icon className="h-4 w-4 mr-2" />
                              <span className="font-medium text-sm">{item.label}</span>
                              {item.href === "/notifications" && unreadCount > 0 && (
                                <span className="ml-auto text-[10px] font-bold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                                  {unreadCount > 9 ? "9+" : unreadCount}
                                </span>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
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
                  asChild
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Change password"
                  data-testid="btn-change-password-nav"
                >
                  <Link href="/change-password">
                    <KeyRound className="h-4 w-4" />
                  </Link>
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
          <header className="h-14 border-b flex items-center gap-2 px-4 bg-background sticky top-0 z-10">
            <SidebarTrigger className="-ml-2 md:hidden" data-testid="btn-mobile-menu" />
            <div className="font-semibold text-sm md:hidden">Msafiri Ops</div>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="ml-auto flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/70 transition-colors w-full max-w-xs"
              data-testid="btn-global-search"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">Search everything…</span>
              <kbd className="ml-auto hidden md:inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          </header>
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
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
