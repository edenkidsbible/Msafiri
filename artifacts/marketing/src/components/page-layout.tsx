import React from "react";
import { Link } from "wouter";
import { Navigation, ArrowLeft } from "lucide-react";

interface PageLayoutProps {
  badge: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function PageLayout({ badge, title, subtitle, children }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Nav */}
      <nav className="border-b border-border/30 py-4 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Navigation className="w-5 h-5 text-primary fill-current" />
            <span className="font-bold text-lg tracking-tight">Msafiri</span>
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="py-16 px-6 text-center border-b border-border/20" style={{ background: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)" }}>
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: "hsl(var(--primary))" }}>{badge}</p>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-base max-w-xl mx-auto leading-relaxed">{subtitle}</p>}
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-16 pb-24">
        {children}
      </div>

      {/* Footer */}
      <footer className="border-t border-border/30 py-8 px-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Navigation className="w-4 h-4 text-primary fill-current" />
          <span className="font-bold text-base">Msafiri</span>
        </div>
        <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground mb-3">
          <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Msafiri Kenya. All rights reserved.</p>
      </footer>
    </div>
  );
}
