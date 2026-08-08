import React, { useEffect } from "react";
import { motion } from "framer-motion";
import {
  ShieldAlert, Zap, Navigation, BellRing, Check, ShieldCheck, Apple, Play,
  MapPin, RadioTower, AlertTriangle, Sun, Moon, BookOpen, Calendar,
  ChevronRight, Camera, Shield, Flame, Car, Ban, CircleOff, Wrench,
  CloudRain, XCircle, CheckCircle2, Layers, Wine, Share2, Users,
  Video, HeartPulse, Route, Bookmark, BarChart2,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useTheme } from "@/components/ThemeProvider";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface BlogPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  author: string;
  publishedAt: string | null;
  createdAt: string;
  readCount: number;
}

function useLatestPosts() {
  return useQuery<{ posts: BlogPostSummary[]; total: number; pages: number }>({
    queryKey: ["/api/blog/posts/home"],
    queryFn: () => fetch(`${API_BASE}/blog/posts?limit=3&page=1`).then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Home() {
  const { resolvedTheme, toggle } = useTheme();
  const { data: blogData } = useLatestPosts();

  useEffect(() => {
    document.title = "Msafiri Kenya — Speed Camera Alert, Dashcam & Road Safety App";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute(
      "content",
      "Msafiri is Kenya's #1 road safety app. Real-time NTSA speed camera alerts, police checkpoint warnings, alcoblow notifications, built-in dashcam, crash assistant, and turn-by-turn navigation — for every Kenyan driver."
    );
    // Open Graph
    let og = document.querySelector('meta[property="og:title"]');
    if (!og) { og = document.createElement("meta"); og.setAttribute("property","og:title"); document.head.appendChild(og); }
    og.setAttribute("content", "Msafiri Kenya — Speed Camera Alert, Dashcam & Road Safety App");
    let ogDesc = document.querySelector('meta[property="og:description"]');
    if (!ogDesc) { ogDesc = document.createElement("meta"); ogDesc.setAttribute("property","og:description"); document.head.appendChild(ogDesc); }
    ogDesc.setAttribute("content","Kenya's most complete road safety app. Speed camera alerts, police checkpoints, dashcam, crash assistant, live navigation and 13+ community report types.");
  }, []);

  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const } }
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden selection:bg-primary/20">

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Msafiri Kenya road safety app" className="w-8 h-8" />
            <span className="font-bold text-lg tracking-tight">Msafiri</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Features</a>
            <a href="#dashcam" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Dashcam</a>
            <Link href="/blog" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Blog</Link>
            <a href="#faq" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">FAQ</a>
            <button
              onClick={toggle}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <a
              href="https://apps.apple.com/ke/app/msafiri-kenya/id6789483834"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Get the App
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 min-h-[90vh] flex items-center">
        <div className="absolute inset-0 z-0">
          <img
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
            alt="Kenya highway at night"
            className="w-full h-full object-cover opacity-30 dark:opacity-40 dark:mix-blend-screen"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
        </div>

        <div className="max-w-7xl mx-auto relative z-10 grid md:grid-cols-2 gap-12 items-center w-full">
          <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="max-w-xl">
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              LIVE ALERTS ACTIVE ACROSS KENYA
            </motion.div>

            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
              Kenya's Road Safety App —{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                Speed Cameras, Dashcam & More.
              </span>
            </motion.h1>

            <motion.p variants={fadeUp} className="text-lg md:text-xl text-muted-foreground mb-4 leading-relaxed">
              Msafiri gives every Kenyan driver real-time NTSA speed camera alerts, police checkpoint warnings, alcoblow notifications, a built-in dashcam, crash documentation, and full turn-by-turn navigation — all in one app.
            </motion.p>
            <motion.p variants={fadeUp} className="text-base text-muted-foreground mb-8 leading-relaxed">
              Works on Thika Road, Mombasa Road, Waiyaki Way, the Nairobi Expressway, and every highway in all 47 counties.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 mb-8">
              <a
                href="https://apps.apple.com/ke/app/msafiri-kenya/id6789483834"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 bg-foreground text-background px-6 py-4 rounded-xl font-bold text-lg hover:bg-foreground/90 transition-all hover:scale-105 active:scale-95"
              >
                <Apple className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-background/60">Download on the</span>
                  <span>App Store</span>
                </div>
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.msafirikenya.app"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 bg-secondary border border-border text-secondary-foreground px-6 py-4 rounded-xl font-bold text-lg hover:bg-secondary/80 transition-all hover:scale-105 active:scale-95"
              >
                <Play className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Get it on</span>
                  <span>Google Play</span>
                </div>
              </a>
            </motion.div>

            <motion.div variants={fadeUp} className="flex flex-wrap gap-x-6 gap-y-2">
              {["Free to download", "Works in background", "No account required", "All 47 counties"].map((t) => (
                <span key={t} className="text-sm text-muted-foreground font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> {t}
                </span>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95, rotate: 2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative hidden md:block"
          >
            <div className="absolute inset-0 bg-primary/20 blur-[120px] rounded-full" />
            <img
              src={`${import.meta.env.BASE_URL}images/mockup-nav.png`}
              alt="Msafiri Kenya navigation screen with speed alerts"
              className="relative z-10 w-full max-w-[340px] mx-auto drop-shadow-[0_60px_80px_rgba(0,0,0,0.9)]"
            />
          </motion.div>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────────────────── */}
      <section className="py-12 border-y border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {[
              { label: "Active Drivers", value: "50K+" },
              { label: "Alerts Daily", value: "120K" },
              { label: "Coverage", value: "47 Counties" },
              { label: "App Rating", value: "4.9 ★" }
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-bold font-mono text-foreground mb-2">{stat.value}</div>
                <div className="text-sm text-muted-foreground uppercase tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Core Features Grid ────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            className="text-center max-w-3xl mx-auto mb-16"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-4">
              <Zap className="w-3 h-3" />
              BUILT FOR KENYAN ROADS
            </div>
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              NTSA Speed Cameras, Police Checkpoints, Dashcam & More — All in One App.
            </h2>
            <p className="text-lg text-muted-foreground">
              Not a generic navigation app retrofitted for Kenya. Msafiri is built specifically for the roads, speed zones, enforcement patterns, and driving realities of Kenyan highways — from Nairobi to Mombasa to Eldoret.
            </p>
          </motion.div>

          {/* Safety alerts */}
          <div className="mb-6">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4 px-1">Road Safety Alerts</h3>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: <ShieldAlert className="w-6 h-6 text-primary" />,
                  title: "NTSA Speed Camera Alerts",
                  desc: "Get voice warnings before reaching fixed and mobile NTSA speed camera locations on Thika Road, Mombasa Road, Waiyaki Way, and all major Kenyan highways. Speed-adaptive: alerts come earlier at highway speeds."
                },
                {
                  icon: <Shield className="w-6 h-6 text-primary" />,
                  title: "Police Checkpoint Warnings",
                  desc: "Real-time crowd-sourced alerts for police roadblocks, spot checks, and random stops across Nairobi and every upcountry route — updated by thousands of drivers every day."
                },
                {
                  icon: <Wine className="w-6 h-6 text-primary" />,
                  title: "Alcoblow Checkpoint Alerts",
                  desc: "Know about active breathalyser checkpoints before you reach them. Community-reported and verified by multiple drivers — so you always know what's ahead on your route."
                },
                {
                  icon: <Zap className="w-6 h-6 text-primary" />,
                  title: "Speed Zone Change Warnings",
                  desc: "Sudden drops from 100 to 50 km/h are common on Kenyan highways. Msafiri warns you before you cross into a lower speed zone and get caught off guard by an NTSA camera."
                },
                {
                  icon: <BellRing className="w-6 h-6 text-primary" />,
                  title: "Audio Alerts — Eyes on Road",
                  desc: "Quiet background mode speaks over your music or Google Maps only when you need to pay attention. Designed to be informative without being distracting."
                },
                {
                  icon: <RadioTower className="w-6 h-6 text-primary" />,
                  title: "HERE Live Traffic Incidents",
                  desc: "Real-time traffic incidents, accidents, and congestion from HERE Technologies layered onto your drive — not just community reports, but live data from the road network."
                },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6 } } }}
                  className="bg-card border border-card-border rounded-3xl p-8 hover:border-primary/30 transition-colors"
                >
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">{feature.icon}</div>
                  <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Navigation */}
          <div className="mb-6">
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4 px-1">Navigation</h3>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: <Navigation className="w-6 h-6 text-primary" />,
                  title: "Turn-by-Turn Navigation",
                  desc: "Full route guidance with voice instructions, real-time ETA, live speed alerts, and hazard warnings built into every turn — tailored for Kenyan road names and landmarks."
                },
                {
                  icon: <Route className="w-6 h-6 text-primary" />,
                  title: "Route Hazard Preview",
                  desc: "Before you start driving, see every speed camera, police checkpoint, and community-reported hazard on your entire route. Know what's ahead before you leave."
                },
                {
                  icon: <MapPin className="w-6 h-6 text-primary" />,
                  title: "Works with Google Maps & Waze",
                  desc: "Run Msafiri alongside Google Maps or Waze without interference. Your navigation app handles directions; Msafiri adds the safety layer your navigation app is missing."
                },
                {
                  icon: <Bookmark className="w-6 h-6 text-primary" />,
                  title: "Saved Places & Planned Trips",
                  desc: "Save Home, Work, and frequent destinations for one-tap navigation. Plan trips in advance and get a full hazard briefing on your route before you even turn the key."
                },
                {
                  icon: <Moon className="w-6 h-6 text-primary" />,
                  title: "Night HUD Mode",
                  desc: "Switch to heads-up display with high-contrast, full-screen speed and alert readout — optimised for night driving so you can glance and refocus on the road instantly."
                },
                {
                  icon: <BarChart2 className="w-6 h-6 text-primary" />,
                  title: "Post-Trip Summary",
                  desc: "After each drive, see a full summary: distance covered, time on the road, speed events triggered, and safety alerts encountered — to help you drive smarter every day."
                },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6 } } }}
                  className="bg-card border border-card-border rounded-3xl p-8 hover:border-primary/30 transition-colors"
                >
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">{feature.icon}</div>
                  <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Community & More */}
          <div>
            <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4 px-1">Community & Safety</h3>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: <Share2 className="w-6 h-6 text-primary" />,
                  title: "Live Trip Sharing",
                  desc: "Tap once and Msafiri generates a short link your family can open in any browser. They see your position, speed, and ETA live — no app download needed on their end."
                },
                {
                  icon: <BookOpen className="w-6 h-6 text-primary" />,
                  title: "NTSA Driver Safety Course",
                  desc: "Interactive lessons, traffic sign guides, and official NTSA fine references — all built into the app, free to access, aligned with Kenya's Highway Code."
                },
                {
                  icon: <RadioTower className="w-6 h-6 text-primary" />,
                  title: "Live Community Reports",
                  desc: "Thousands of Kenyan drivers reporting in real time. Every report is confirmed or denied by the community — keeping the map accurate and fresh across 47 counties."
                },
              ].map((feature, i) => (
                <motion.div
                  key={i}
                  initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6 } } }}
                  className="bg-card border border-card-border rounded-3xl p-8 hover:border-primary/30 transition-colors"
                >
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">{feature.icon}</div>
                  <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Community report types */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="mt-20"
          >
            <div className="text-center max-w-2xl mx-auto mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-4">
                <RadioTower className="w-3 h-3" />
                COMMUNITY POWERED
              </div>
              <h3 className="text-2xl md:text-4xl font-bold mb-4">Report Any Road Incident in One Tap.</h3>
              <p className="text-lg text-muted-foreground">
                See something on the road? Alert every driver behind you instantly. Msafiri drivers can report 13 different incident types — from potholes to alcoblow checkpoints to road closures.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[
                { icon: <Camera className="w-5 h-5" />, label: "Speed Camera", color: "text-red-500", bg: "bg-red-500/10", desc: "Fixed or mobile NTSA camera ahead" },
                { icon: <Shield className="w-5 h-5" />, label: "Police Check", color: "text-blue-600", bg: "bg-blue-600/10", desc: "Police checkpoint or random stop" },
                { icon: <Wine className="w-5 h-5" />, label: "Alcoblow", color: "text-indigo-700", bg: "bg-indigo-700/10", desc: "Breathalyser checkpoint active" },
                { icon: <Flame className="w-5 h-5" />, label: "Accident", color: "text-red-700", bg: "bg-red-700/10", desc: "Crash or collision on road" },
                { icon: <Car className="w-5 h-5" />, label: "Traffic Jam", color: "text-orange-600", bg: "bg-orange-600/10", desc: "Heavy congestion ahead" },
                { icon: <Ban className="w-5 h-5" />, label: "Roadblock", color: "text-purple-700", bg: "bg-purple-700/10", desc: "Road fully blocked or diverted" },
                { icon: <AlertTriangle className="w-5 h-5" />, label: "Hazard", color: "text-amber-600", bg: "bg-amber-600/10", desc: "General danger on the road" },
                { icon: <CircleOff className="w-5 h-5" />, label: "Pothole", color: "text-orange-500", bg: "bg-orange-500/10", desc: "Deep pothole or damaged tarmac" },
                { icon: <Layers className="w-5 h-5" />, label: "Debris", color: "text-stone-600", bg: "bg-stone-600/10", desc: "Rocks, cargo or debris on road" },
                { icon: <Wrench className="w-5 h-5" />, label: "Broken Down", color: "text-amber-700", bg: "bg-amber-700/10", desc: "Stalled vehicle blocking lane" },
                { icon: <CloudRain className="w-5 h-5" />, label: "Bad Weather", color: "text-slate-600", bg: "bg-slate-600/10", desc: "Fog, heavy rain or flooding" },
                { icon: <XCircle className="w-5 h-5" />, label: "Road Closed", color: "text-rose-700", bg: "bg-rose-700/10", desc: "Road completely closed ahead" },
                { icon: <CheckCircle2 className="w-5 h-5" />, label: "Road Clear", color: "text-green-600", bg: "bg-green-600/10", desc: "Previous incident now cleared" },
              ].map((incident, i) => (
                <motion.div
                  key={i}
                  variants={{ hidden: { opacity: 0, scale: 0.9 }, visible: { opacity: 1, scale: 1, transition: { delay: i * 0.04, duration: 0.4 } } }}
                  className="bg-card border border-card-border rounded-2xl p-4 flex flex-col items-center text-center hover:border-primary/30 transition-colors group"
                >
                  <div className={`w-11 h-11 rounded-xl ${incident.bg} flex items-center justify-center mb-3 ${incident.color}`}>
                    {incident.icon}
                  </div>
                  <p className="font-bold text-sm mb-1">{incident.label}</p>
                  <p className="text-xs text-muted-foreground leading-tight">{incident.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── App Screenshots ───────────────────────────────────────────────────── */}
      <section className="py-20 px-6 overflow-hidden bg-muted/10">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="text-center mb-14"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Kenya's Road Safety App — See It in Action.</h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Every screen designed to keep your eyes on the road, whether you're on Thika Road, Mombasa Road, or the Nairobi Expressway.
            </p>
          </motion.div>
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={staggerContainer}
            className="flex gap-6 overflow-x-auto pb-4 md:justify-center snap-x snap-mandatory"
            style={{ scrollbarWidth: "none" }}
          >
            {[
              { src: "mockup-nav.png",             label: "Navigation" },
              { src: "mockup-route-incidents.png", label: "Route Safety" },
              { src: "mockup-map.png",             label: "Hazard Map" },
              { src: "mockup-browse.png",          label: "Nearby Places" },
              { src: "mockup-fines.png",           label: "NTSA Fines" },
              { src: "mockup-report.png",          label: "Report Incident" },
              { src: "mockup-settings.png",        label: "Emergency SOS" },
            ].map((shot, i) => (
              <motion.div
                key={i}
                variants={{ hidden: { opacity: 0, y: 30, scale: 0.96 }, visible: { opacity: 1, y: 0, scale: 1, transition: { delay: i * 0.08, duration: 0.6 } } }}
                className="flex-shrink-0 snap-center flex flex-col items-center gap-3"
              >
                <img
                  src={`${import.meta.env.BASE_URL}images/${shot.src}`}
                  alt={`Msafiri Kenya — ${shot.label}`}
                  className="w-[220px] md:w-[240px] drop-shadow-[0_24px_48px_rgba(0,0,0,0.45)] hover:scale-[1.03] transition-transform duration-300"
                />
                <span className="text-sm font-medium text-muted-foreground">{shot.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Dashcam ──────────────────────────────────────────────────────────── */}
      <section id="dashcam" className="py-24 px-6 border-t border-border">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-6">
              <Video className="w-3 h-3" />
              BUILT-IN DASHCAM
            </div>
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              A Dashcam App Built Right Into Your Safety App.
            </h2>
            <p className="text-xl text-muted-foreground mb-4">
              No separate dashcam device needed. Msafiri records the road ahead silently while you drive — automatically splitting clips, saving important moments, and backing up to the cloud when you're on Wi-Fi.
            </p>
            <p className="text-lg text-muted-foreground mb-8">
              If something happens, your footage is already saved. Kenya's roads can be unpredictable — your dashcam shouldn't be.
            </p>
            <ul className="space-y-4">
              {[
                "Records automatically when you start driving — no extra taps",
                "Clips saved to your phone's local storage",
                "Lock important clips to prevent them from being overwritten",
                "Check camera angle before recording starts — every time",
                "Cloud backup when connected to Wi-Fi",
                "View, share, or delete clips from inside the app",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-base font-medium text-foreground">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex justify-center"
          >
            <div className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-5">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </div>
                <span className="text-sm font-bold text-foreground">Dashcam Recording</span>
                <span className="ml-auto text-xs font-mono text-red-500 font-bold">● REC</span>
              </div>
              <div className="bg-muted/60 rounded-2xl h-40 flex items-center justify-center mb-5 relative overflow-hidden border border-border">
                <div className="absolute inset-0 bg-gradient-to-br from-neutral-900/60 to-neutral-800/40" />
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <Video className="w-10 h-10 text-white/60" />
                  <span className="text-xs text-white/50 font-medium">Rear Camera Active</span>
                </div>
                <div className="absolute top-3 right-3 bg-red-500/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">1080p HD</div>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Recording", value: "02:14:37" },
                  { label: "Clips saved", value: "6 clips" },
                  { label: "Storage used", value: "1.2 GB / 4 GB" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-sm font-bold font-mono">{value}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Last clip locked</span>
                  <span className="text-xs font-mono text-primary font-semibold">🔒 Preserved</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Crash Assistant ───────────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-muted/10 border-t border-border">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="order-2 md:order-1 flex justify-center"
          >
            <div className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
                  <HeartPulse className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-bold">Accident Assistant</p>
                  <p className="text-xs text-muted-foreground">Step-by-step guidance</p>
                </div>
              </div>
              <div className="space-y-2.5">
                {[
                  { step: "1", label: "Call Emergency Services", done: true },
                  { step: "2", label: "Document the Scene", done: true },
                  { step: "3", label: "Collect Witness Details", done: true },
                  { step: "4", label: "Photograph Vehicles & Road", done: false, active: true },
                  { step: "5", label: "Seek Medical Attention", done: false },
                  { step: "6", label: "File Police Report", done: false },
                  { step: "7", label: "Export PDF Report", done: false },
                ].map(({ step, label, done, active }) => (
                  <div
                    key={step}
                    className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${active ? "bg-primary/10 border border-primary/20" : done ? "opacity-60" : "opacity-40"}`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${done ? "bg-green-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {done ? "✓" : step}
                    </div>
                    <span className={`text-sm font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <button className="w-full bg-primary text-primary-foreground py-2.5 rounded-xl text-sm font-bold">
                  Continue Documentation →
                </button>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
            className="order-1 md:order-2"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-500 mb-6">
              <HeartPulse className="w-3 h-3" />
              CRASH / ACCIDENT ASSISTANT
            </div>
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              If You're in an Accident, Msafiri Walks You Through Every Step.
            </h2>
            <p className="text-xl text-muted-foreground mb-4">
              After a collision, most people don't know what to do — especially on a Kenyan highway far from help. The Msafiri Accident Assistant guides you through all 7 steps: from calling emergency services to collecting witness details and filing a police report.
            </p>
            <p className="text-lg text-muted-foreground mb-8">
              At the end, export a full PDF accident report — ready to submit to your insurance company or NTSA.
            </p>
            <ul className="space-y-4">
              {[
                "7-step guided accident documentation flow",
                "Photo capture for vehicles, damage, and road conditions",
                "Witness and third-party contact collection",
                "GPS-stamped location recorded automatically",
                "PDF report export for insurance and NTSA",
                "Emergency SOS — call ambulance, police, or your contact in one tap",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-base font-medium text-foreground">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* ── Live Trip Sharing ─────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-6">
              <Share2 className="w-3 h-3" />
              LIVE TRIP SHARING
            </div>
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              Let someone watch over you — in real time.
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              Tap one button and Msafiri generates a short link your family can open in any browser. They see your position on a live map, your speed, and your ETA — no app download required.
            </p>
            <ul className="space-y-4">
              {[
                "Short branded link — works in any browser, no app needed",
                "Live position updates every 5 seconds",
                "Shows speed, ETA, and destination on the map",
                "Session auto-ends when your drive completes",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-base font-medium text-foreground">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex justify-center"
          >
            <div className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center gap-3 mb-5">
                <div className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                </div>
                <span className="text-sm font-bold text-foreground">Live Tracking</span>
                <span className="ml-auto text-xs font-mono text-green-500 font-bold">LIVE</span>
              </div>
              <div className="bg-muted/60 rounded-2xl h-36 flex items-center justify-center mb-5 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-primary/15" />
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg">
                    <Users className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">Moving on Thika Road</span>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Speed", value: "78 km/h" },
                  { label: "ETA", value: "23 min" },
                  { label: "Distance left", value: "14.2 km" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <span className="text-sm font-bold font-mono">{value}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Share link</span>
                  <span className="text-xs font-mono text-primary font-semibold">msafiri.app/live/A3X9K2</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Storytelling / Co-pilot ───────────────────────────────────────────── */}
      <section className="py-24 px-6 relative overflow-hidden border-t border-border">
        <div className="absolute inset-0 z-0">
          <img
            src={`${import.meta.env.BASE_URL}images/nairobi-night.png`}
            alt="Nairobi highway at night"
            className="w-full h-full object-cover opacity-20 dark:opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/50" />
        </div>

        <div className="max-w-7xl mx-auto relative z-10 grid md:grid-cols-2 gap-16 items-center">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              Your Complete Co-pilot for Kenyan Roads.
            </h2>
            <p className="text-xl text-muted-foreground mb-6">
              We know what driving in Kenya feels like. The sudden speed bumps, the hidden NTSA cameras on Waiyaki Way, the alcoblow checkpoints that appear overnight on Ngong Road, the speed zone changes on the Nairobi–Nakuru Highway.
            </p>
            <p className="text-xl text-muted-foreground mb-8">
              Msafiri doesn't try to replace your navigation app. It runs quietly alongside Google Maps or Waze, speaking up only when you need to pay attention — and recording everything when you don't.
            </p>
            <ul className="space-y-4">
              {[
                "Unobtrusive background mode — silent until you need it",
                "Voice alerts tailored for driving at speed",
                "Night HUD mode for low-light and long-distance driving",
                "Dashcam recording while you navigate",
                "Low battery and data consumption",
                "No account, no sign-up, no personal data required"
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-lg font-medium text-foreground">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <div className="relative flex justify-center md:justify-end">
            <img
              src={`${import.meta.env.BASE_URL}images/mockup-route-incidents.png`}
              alt="Msafiri route hazards and incidents"
              className="w-full max-w-[300px] drop-shadow-[0_40px_80px_rgba(0,0,0,0.7)]"
            />
          </div>
        </div>
      </section>

      {/* ── Pro Pricing ───────────────────────────────────────────────────────── */}
      <section id="pro" className="py-24 px-6 bg-muted/20 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Msafiri Pro</h2>
            <p className="text-lg text-muted-foreground">
              Unlock the full power of Kenya's road safety platform.
            </p>
          </motion.div>

          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
            className="bg-card border border-primary/30 rounded-[2rem] p-8 md:p-12 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2" />

            <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6 relative z-10">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-2xl font-bold">Premium Tier</h3>
                  <span className="bg-primary/20 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Most Popular</span>
                </div>
                <p className="text-muted-foreground">Everything you need for total peace of mind on Kenyan roads.</p>
              </div>
              <div className="text-left md:text-right">
                <div className="text-4xl font-bold font-mono">KES 100<span className="text-xl text-muted-foreground">/wk</span></div>
                <p className="text-sm text-muted-foreground mt-1">or KES 300/month <span className="text-primary">(save 25%)</span></p>
                <p className="text-sm text-primary mt-1">3-day free trial included</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-y-4 gap-x-8 mb-10 relative z-10">
              {[
                "Real-time mobile police checkpoint alerts",
                "Live community-reported hazards",
                "Ad-free experience",
                "Background audio alerts",
                "Live trip location sharing",
                "Dashcam cloud backup",
                "Crash / accident assistant + PDF export",
                "NTSA driver safety course",
                "Route hazard preview before driving",
                "Saved places & planned trips",
                "Post-trip drive summary",
                "Priority support",
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-primary" />
                  </div>
                  <span className="font-medium">{feature}</span>
                </div>
              ))}
            </div>

            <button className="w-full bg-primary text-primary-foreground py-4 rounded-xl font-bold text-lg hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-95 relative z-10 shadow-[0_0_40px_rgba(234,142,40,0.3)]">
              Start Free Trial — 3 Days Free
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 px-6 relative border-t border-border">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Frequently Asked Questions</h2>
            <p className="text-lg text-muted-foreground">
              Everything you need to know about Msafiri, NTSA speed cameras, and road safety in Kenya.
            </p>
          </motion.div>

          <Accordion type="single" collapsible className="w-full">
            {[
              {
                q: "What is Msafiri Kenya?",
                a: "Msafiri is Kenya's most complete road safety app. It alerts you to NTSA speed cameras, police checkpoints, alcoblow (breathalyser) checkpoints, and 13 other types of road hazards — in real time, across all 47 counties. It also includes built-in turn-by-turn navigation, a dashcam, a crash assistant, live trip sharing, and an NTSA driver safety course."
              },
              {
                q: "How do NTSA speed cameras work in Kenya?",
                a: "NTSA deploys both fixed and mobile speed cameras across Kenyan highways. Fixed cameras are installed at permanent positions on roads like Thika Road, Mombasa Road, Waiyaki Way, and the Southern Bypass. Mobile cameras are operated by traffic police who can deploy them anywhere. Msafiri alerts you to both types — fixed camera locations are pre-loaded into the app, and mobile cameras are reported in real-time by other drivers."
              },
              {
                q: "How much is the fine for speeding in Kenya?",
                a: "NTSA speeding fines under the Traffic (Amendment) Act depend on how much you exceed the limit. A warning is issued for minor over-speed; KES 500 for moderate excess; KES 3,000 for significant excess; KES 10,000 for serious excess; and court appearances with potential suspension for 21 km/h or more above the limit. You have 7 days to pay before additional penalties apply. The Msafiri NTSA course includes the full fine schedule."
              },
              {
                q: "Does Msafiri have a built-in dashcam?",
                a: "Yes. Msafiri includes a full dashcam that records the road ahead while you drive. It runs in the background, splits footage into clips automatically, and lets you lock important clips so they aren't overwritten. Cloud backup is available for Pro subscribers. You can view, share, or delete clips directly inside the app — no separate dashcam app or device needed."
              },
              {
                q: "What is the speed limit on major Kenyan highways?",
                a: "Speed limits on Kenyan roads: Urban roads — 50 km/h. Highways outside towns (single carriageway) — 100 km/h. Dual carriageways — 110 km/h. The Nairobi Expressway — 100 km/h. Heavy commercial vehicles — lower limits apply. Speed zones can change frequently and without warning — Msafiri alerts you every time the limit changes on your route."
              },
              {
                q: "What happens if I'm involved in an accident in Kenya?",
                a: "Msafiri has a built-in Accident Assistant that guides you through all 7 steps: call emergency services, document the scene, collect witness details, photograph vehicles and road conditions, seek medical attention, file a police report, and export a PDF report for your insurance. GPS location is automatically recorded. The PDF can be submitted directly to your insurer or NTSA."
              },
              {
                q: "Can I use Msafiri alongside Google Maps or Waze?",
                a: "Absolutely. Msafiri is designed to run in the background while you use any navigation app. Start Msafiri first, then open Google Maps or Waze — you'll hear Msafiri's audio alerts over your navigation instructions without any interference. You can also use Msafiri's built-in navigation if you prefer a single app experience."
              },
              {
                q: "Does Msafiri work outside Nairobi?",
                a: "Yes — Msafiri covers all 47 counties. We have active speed camera data, community reports, and drivers contributing on all major routes: Mombasa Road, Nakuru Highway, Eldoret Highway, Kisumu Road, and the coastal road. The more drivers in an area, the more accurate and up-to-date the alerts."
              },
              {
                q: "Can I share my location with family while I drive?",
                a: "Yes. The Live Trip Sharing feature generates a short link in one tap. Whoever you send it to can open it in any browser and watch your position, speed, and ETA update in real time — no app download needed on their end. Perfect for late-night drives, long highways, or whenever someone wants to know you're safe."
              },
              {
                q: "Is there a driving course inside the app?",
                a: "Yes. The NTSA Driver Safety Course is built into the Browse tab — free for all users. It includes interactive lessons, traffic sign identification, hazard awareness, and the complete NTSA fine schedule. It's aligned with Kenya's Highway Code and designed for both new and experienced drivers."
              },
              {
                q: "Does Msafiri show alcoblow checkpoint locations?",
                a: "Yes. Alcoblow (breathalyser) checkpoints are reported by the community in real time. When multiple drivers confirm an alcoblow checkpoint, it appears on the map and triggers an audio alert before you reach it. Reports are automatically dismissed when drivers confirm the checkpoint is gone."
              },
              {
                q: "What payment methods do you accept for Pro?",
                a: "Msafiri Pro is available via M-PESA through the app, as well as standard Apple App Store and Google Play subscriptions. The weekly plan costs KES 100 and the monthly plan costs KES 300 — both include a 3-day free trial. You can cancel at any time."
              }
            ].map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-b border-border">
                <AccordionTrigger className="text-left text-lg font-medium py-6 hover:text-primary transition-colors">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-6">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── Blog Preview ─────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-muted/10 border-t border-border">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12"
          >
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-4">
                <BookOpen className="w-3 h-3" />
                MSAFIRI KENYA BLOG
              </div>
              <h2 className="text-3xl md:text-5xl font-bold">Road Safety Guides for Kenyan Drivers.</h2>
              <p className="text-lg text-muted-foreground mt-3 max-w-xl">
                Expert articles on NTSA fines, speed camera locations, alcoblow checkpoints, dashcam laws, and traffic tips for Nairobi and Kenya highways.
              </p>
            </div>
            <Link href="/blog" className="inline-flex items-center gap-2 text-primary font-semibold hover:underline whitespace-nowrap shrink-0">
              View all articles <ChevronRight className="w-4 h-4" />
            </Link>
          </motion.div>

          {blogData?.posts && blogData.posts.length > 0 ? (
            <motion.div
              initial="hidden" whileInView="visible" viewport={{ once: true }}
              variants={staggerContainer}
              className="grid md:grid-cols-3 gap-6"
            >
              {blogData.posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6 } } }}
                >
                  <Link href={`/blog/${post.slug}`}>
                    <div className="group bg-card border border-card-border rounded-3xl overflow-hidden hover:border-primary/30 transition-colors cursor-pointer h-full flex flex-col">
                      <div className="h-44 bg-primary/5 flex items-center justify-center">
                        <img src={logo} alt="" className="w-12 h-12 opacity-20" />
                      </div>
                      <div className="p-6 flex flex-col flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                          <Calendar className="w-3 h-3" />
                          {formatDate(post.publishedAt || post.createdAt)}
                        </div>
                        <h3 className="font-bold text-lg leading-snug mb-3 group-hover:text-primary transition-colors line-clamp-3">{post.title}</h3>
                        {post.excerpt && (
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-4 flex-1">{post.excerpt}</p>
                        )}
                        <span className="inline-flex items-center gap-1 text-primary text-sm font-semibold mt-auto">
                          Read article <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-card border border-card-border rounded-3xl overflow-hidden h-72 animate-pulse">
                  <div className="h-44 bg-muted" />
                  <div className="p-6 space-y-3">
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-4 bg-muted rounded w-full" />
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 relative overflow-hidden border-t border-border">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
            <h2 className="text-4xl md:text-6xl font-bold mb-6">
              Download Kenya's Most Complete Road Safety App — Free.
            </h2>
            <p className="text-xl text-muted-foreground mb-4 max-w-2xl mx-auto">
              Join thousands of Kenyan drivers who trust Msafiri every day for NTSA speed camera alerts, police checkpoint warnings, alcoblow notifications, dashcam recording, and full navigation.
            </p>
            <p className="text-base text-muted-foreground mb-10 max-w-xl mx-auto">
              Free to download on iOS and Android. No account required. Covers all 47 counties.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <a
                href="https://apps.apple.com/ke/app/msafiri-kenya/id6789483834"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 bg-foreground text-background px-8 py-4 rounded-xl font-bold text-lg hover:bg-foreground/90 transition-all hover:scale-105 active:scale-95"
              >
                <Apple className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-background/60">Download on the</span>
                  <span>App Store</span>
                </div>
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.msafirikenya.app"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 bg-secondary border border-border text-secondary-foreground px-8 py-4 rounded-xl font-bold text-lg hover:bg-secondary/80 transition-all hover:scale-105 active:scale-95"
              >
                <Play className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Get it on</span>
                  <span>Google Play</span>
                </div>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer className="py-12 px-6 bg-background border-t border-border">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Msafiri Kenya" className="w-6 h-6" />
            <span className="font-bold text-xl tracking-tight">Msafiri</span>
          </div>

          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground font-medium">
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          </div>

          <div className="text-sm text-muted-foreground text-center">
            <span>© {new Date().getFullYear()} Msafiri Kenya. All rights reserved.</span>
            <br />
            <span className="text-xs">Built in Nairobi 🇰🇪 for Kenyan drivers.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
