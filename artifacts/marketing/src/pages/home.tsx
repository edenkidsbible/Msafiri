import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Zap, Navigation, BellRing, Check, ShieldCheck, Apple, Play, Plus, MapPin, RadioTower, AlertTriangle, Sun, Moon, BookOpen, Calendar, ChevronRight, Camera, Shield, Flame, Car, Ban, CircleOff, Wrench, CloudRain, XCircle, CheckCircle2, Layers, Wine, Siren } from "lucide-react";
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
    document.title = "Msafiri Kenya — Speed Camera & Police Checkpoint Alerts App";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "Msafiri is Kenya's #1 road safety app. Get real-time NTSA speed camera alerts, police checkpoint warnings, and speed zone notifications for Nairobi and all major Kenyan highways.");
  }, []);

  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const } }
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden selection:bg-primary/20">
      
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Msafiri" className="w-8 h-8" />
            <span className="font-bold text-lg tracking-tight">Msafiri</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Features</a>
            <Link href="/blog" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Blog</Link>
            <a href="#faq" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">FAQ</a>
            <button
              onClick={toggle}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button className="bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors">
              Get the App
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 min-h-[90vh] flex items-center">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt="Cinematic night highway" 
            className="w-full h-full object-cover opacity-30 dark:opacity-40 dark:mix-blend-screen"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
        </div>
        
        <div className="max-w-7xl mx-auto relative z-10 grid md:grid-cols-2 gap-12 items-center w-full">
          <motion.div 
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
            className="max-w-xl"
          >
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-mono text-primary mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              LIVE ALERTS ACTIVE IN KENYA
            </motion.div>
            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
              The road is unpredictable.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
                You don't have to be.
              </span>
            </motion.h1>
            <motion.p variants={fadeUp} className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed">
              Msafiri keeps you ahead of speed cameras, police checkpoints, and speed zones on Kenyan roads. Quiet awareness, exactly when you need it.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 mb-8">
              <a href="https://apps.apple.com/us/app/msafiri-kenya/id6789483834" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-3 bg-foreground text-background px-6 py-4 rounded-xl font-bold text-lg hover:bg-foreground/90 transition-all hover:scale-105 active:scale-95">
                <Apple className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-background/60">Download on the</span>
                  <span>App Store</span>
                </div>
              </a>
              <a href="https://play.google.com/store/apps/details?id=com.msafirikenya.app" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-3 bg-secondary border border-border text-secondary-foreground px-6 py-4 rounded-xl font-bold text-lg hover:bg-secondary/80 transition-all hover:scale-105 active:scale-95">
                <Play className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Get it on</span>
                  <span>Google Play</span>
                </div>
              </a>
            </motion.div>
            <motion.p variants={fadeUp} className="text-sm text-muted-foreground font-mono">
              Free to download • Premium features available
            </motion.p>
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
              alt="Msafiri Navigation Screen" 
              className="relative z-10 w-full max-w-[340px] mx-auto drop-shadow-[0_60px_80px_rgba(0,0,0,0.9)]"
            />
          </motion.div>
        </div>
      </section>

      {/* Social Proof / Stats */}
      <section className="py-12 border-y border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            {[
              { label: "Active Drivers", value: "50K+" },
              { label: "Alerts Daily", value: "120K" },
              { label: "Coverage", value: "47 Counties" },
              { label: "App Store Rating", value: "4.9/5" }
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl md:text-4xl font-bold font-mono text-foreground mb-2">{stat.value}</div>
                <div className="text-sm text-muted-foreground uppercase tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            className="text-center max-w-2xl mx-auto mb-16"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-6">NTSA Speed Cameras, Checkpoints & Speed Zones — All in One App.</h2>
            <p className="text-lg text-muted-foreground">
              Built specifically for everyday Kenyan driving. No cluttered maps, no unnecessary noise — just the road safety alerts that matter on Nairobi and Kenya highways.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: <ShieldAlert className="w-6 h-6 text-primary" />,
                title: "NTSA Speed Camera Alerts",
                desc: "Get notified before you reach fixed and mobile NTSA speed camera locations on Thika Road, Mombasa Road, and all major Kenyan highways."
              },
              {
                icon: <Shield className="w-6 h-6 text-primary" />,
                title: "Police Checkpoint Warnings",
                desc: "Real-time crowd-sourced alerts for police roadblocks and random checks across Nairobi and upcountry routes."
              },
              {
                icon: <Zap className="w-6 h-6 text-primary" />,
                title: "Speed Zone Changes",
                desc: "Sudden drop from 100 to 50 km/h? Msafiri warns you before you miss the sign and get caught by an NTSA camera."
              },
              {
                icon: <RadioTower className="w-6 h-6 text-primary" />,
                title: "Live Community Reports",
                desc: "Thousands of Kenyan drivers reporting in real-time to keep road safety alerts accurate and fresh across 47 counties."
              },
              {
                icon: <BellRing className="w-6 h-6 text-primary" />,
                title: "Audio Alerts — Eyes on Road",
                desc: "Runs quietly in the background and speaks over your music or navigation only when you need to pay attention."
              },
              {
                icon: <MapPin className="w-6 h-6 text-primary" />,
                title: "Works with Google Maps & Waze",
                desc: "Run Msafiri alongside Google Maps or Waze without interference. Your navigation, plus our safety layer."
              }
            ].map((feature, i) => (
              <motion.div 
                key={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-50px" }}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6 } }
                }}
                className="bg-card border border-card-border rounded-3xl p-8 hover:border-primary/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Community Reporting — all incident types */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
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
                See something on the road? Alert every driver behind you instantly. Msafiri drivers can report 13 different incident types — from potholes to alcoblow checkpoints.
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
                  variants={{
                    hidden: { opacity: 0, scale: 0.9 },
                    visible: { opacity: 1, scale: 1, transition: { delay: i * 0.04, duration: 0.4 } }
                  }}
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

      {/* App Screenshots Showcase */}
      <section className="py-20 px-6 overflow-hidden bg-muted/10">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUp}
            className="text-center mb-14"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Kenya's Road Safety App — See It in Action.</h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Every screen designed to keep your eyes on the road, whether you're on Thika Road, Mombasa Road, or the Nairobi Expressway.
            </p>
          </motion.div>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={staggerContainer}
            className="flex gap-6 overflow-x-auto pb-4 md:justify-center snap-x snap-mandatory"
            style={{ scrollbarWidth: "none" }}
          >
            {[
              { src: "mockup-nav.png",              label: "Navigation" },
              { src: "mockup-route-incidents.png",  label: "Route Safety" },
              { src: "mockup-map.png",              label: "Hazard Map" },
              { src: "mockup-browse.png",           label: "Nearby Places" },
              { src: "mockup-fines.png",            label: "NTSA Fines" },
              { src: "mockup-report.png",           label: "Report Incident" },
              { src: "mockup-settings.png",         label: "Emergency SOS" },
            ].map((shot, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 30, scale: 0.96 },
                  visible: { opacity: 1, y: 0, scale: 1, transition: { delay: i * 0.08, duration: 0.6 } }
                }}
                className="flex-shrink-0 snap-center flex flex-col items-center gap-3"
              >
                <img
                  src={`${import.meta.env.BASE_URL}images/${shot.src}`}
                  alt={shot.label}
                  className="w-[220px] md:w-[240px] drop-shadow-[0_24px_48px_rgba(0,0,0,0.45)] hover:scale-[1.03] transition-transform duration-300"
                />
                <span className="text-sm font-medium text-muted-foreground">{shot.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Vibe / Storytelling Section */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/nairobi-night.png`} 
            alt="Nairobi Highway" 
            className="w-full h-full object-cover opacity-20 dark:opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/50" />
        </div>
        
        <div className="max-w-7xl mx-auto relative z-10 grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
          >
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              Your Co-pilot for Kenyan Roads — Speed Cameras, Checkpoints & Alcoblow Alerts.
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              We know what driving in Kenya feels like. The sudden speed bumps, the hidden NTSA cameras on Waiyaki Way, the unpredictable speed zone changes on the Nairobi–Nakuru Highway.
            </p>
            <p className="text-xl text-muted-foreground mb-8">
              Msafiri doesn't try to replace your navigation app. It runs quietly in the background, speaking up only when you need to pay attention.
            </p>
            <ul className="space-y-4">
              {[
                "Unobtrusive background mode",
                "Audio alerts tailored for driving",
                "Dark mode optimized for night driving",
                "Low battery consumption"
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
              alt="Incidents on your route"
              className="w-full max-w-[300px] drop-shadow-[0_40px_80px_rgba(0,0,0,0.7)]"
            />
          </div>
        </div>
      </section>

      {/* Pricing / Pro */}
      <section id="pro" className="py-24 px-6 bg-muted/20">
        <div className="max-w-3xl mx-auto">
          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Msafiri Pro</h2>
            <p className="text-lg text-muted-foreground">
              Unlock the full power of community intelligence.
            </p>
          </motion.div>

          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            className="bg-card border border-primary/30 rounded-[2rem] p-8 md:p-12 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2" />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6 relative z-10">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-2xl font-bold">Premium Tier</h3>
                  <span className="bg-primary/20 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                    Most Popular
                  </span>
                </div>
                <p className="text-muted-foreground">Everything you need for total peace of mind.</p>
              </div>
              <div className="text-left md:text-right">
                <div className="text-4xl font-bold font-mono">KES 100<span className="text-xl text-muted-foreground">/wk</span></div>
                <p className="text-sm text-muted-foreground mt-1">or KES 300/month <span className="text-primary">(save 25%)</span></p>
                <p className="text-sm text-primary mt-1">3-day free trial included</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-y-4 gap-x-8 mb-10 relative z-10">
              {[
                "Real-time mobile police checkpoints",
                "Live user-reported hazards",
                "Ad-free experience",
                "Background audio alerts",
                "Route history & insights",
                "Priority support"
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
              Start Free Trial
            </button>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24 px-6 relative">
        <div className="max-w-3xl mx-auto">
          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Frequently Asked Questions About Msafiri Kenya</h2>
            <p className="text-lg text-muted-foreground">
              Everything you need to know about Kenya's road safety and speed camera alert app.
            </p>
          </motion.div>

          <Accordion type="single" collapsible className="w-full">
            {[
              {
                q: "Does it work outside Nairobi?",
                a: "Yes! Msafiri relies on a massive community of drivers across Kenya. We have active reports from Mombasa, Nakuru, Kisumu, Eldoret, and all major highways."
              },
              {
                q: "Can I use it with Google Maps?",
                a: "Absolutely. Msafiri is designed to run in the background. Just start Msafiri, open Google Maps or Waze, and you'll hear our audio alerts over your navigation instructions."
              },
              {
                q: "How accurate are the speed camera alerts?",
                a: "Fixed cameras are 100% accurate. Mobile cameras and police checkpoints depend on community reports, which are verified in real-time as multiple drivers confirm them."
              },
              {
                q: "What payment methods do you accept for Pro?",
                a: "We accept M-PESA directly through the app, as well as standard Apple App Store and Google Play subscriptions."
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

      {/* Blog Preview Section */}
      <section className="py-24 px-6 bg-muted/10 border-t border-border">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
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
                Expert articles on NTSA fines, speed cameras, alcoblow locations, and traffic tips for Nairobi and Kenya highways.
              </p>
            </div>
            <Link href="/blog" className="inline-flex items-center gap-2 text-primary font-semibold hover:underline whitespace-nowrap shrink-0">
              View all articles <ChevronRight className="w-4 h-4" />
            </Link>
          </motion.div>

          {blogData?.posts && blogData.posts.length > 0 ? (
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="grid md:grid-cols-3 gap-6"
            >
              {blogData.posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.6 } }
                  }}
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
                        <h3 className="font-bold text-lg leading-snug mb-3 group-hover:text-primary transition-colors line-clamp-3">
                          {post.title}
                        </h3>
                        {post.excerpt && (
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-4 flex-1">
                            {post.excerpt}
                          </p>
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

      {/* CTA / Download */}
      <section className="py-24 px-6 relative overflow-hidden border-t border-border">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl md:text-6xl font-bold mb-6">Download Kenya's #1 Road Safety App — Free.</h2>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Join over 50,000 Kenyan drivers who trust Msafiri every day for NTSA speed camera alerts, police checkpoint warnings, and alcoblow notifications. Download now.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a href="https://apps.apple.com/us/app/msafiri-kenya/id6789483834" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-3 bg-foreground text-background px-8 py-4 rounded-xl font-bold text-lg hover:bg-foreground/90 transition-all hover:scale-105 active:scale-95">
              <Apple className="w-6 h-6 fill-current" />
              <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] font-medium uppercase tracking-wider text-background/60">Download on the</span>
                <span>App Store</span>
              </div>
            </a>
            <a href="https://play.google.com/store/apps/details?id=com.msafirikenya.app" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-3 bg-secondary border border-border text-secondary-foreground px-8 py-4 rounded-xl font-bold text-lg hover:bg-secondary/80 transition-all hover:scale-105 active:scale-95">
              <Play className="w-6 h-6 fill-current" />
              <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Get it on</span>
                <span>Google Play</span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-background border-t border-border">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Msafiri" className="w-6 h-6" />
            <span className="font-bold text-xl tracking-tight">Msafiri</span>
          </div>
          
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground font-medium">
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/blog" className="hover:text-foreground transition-colors">Blog</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          </div>

          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Msafiri Kenya. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
