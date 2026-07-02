import React from "react";
import { motion } from "framer-motion";
import { ShieldAlert, Zap, Navigation, BellRing, Check, ShieldCheck, Apple, Play, Plus, MapPin, RadioTower, AlertTriangle, Sun, Moon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useTheme } from "@/components/ThemeProvider";

export default function Home() {
  const { resolvedTheme, toggle } = useTheme();

  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }
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
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <Navigation className="w-4 h-4 text-primary-foreground fill-current" />
            </div>
            <span className="font-bold text-lg tracking-tight">Msafiri</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Features</a>
            <a href="#pro" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block">Msafiri Pro</a>
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
              <a href="#" className="flex items-center justify-center gap-3 bg-foreground text-background px-6 py-4 rounded-xl font-bold text-lg hover:bg-foreground/90 transition-all hover:scale-105 active:scale-95">
                <Apple className="w-6 h-6 fill-current" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-background/60">Download on the</span>
                  <span>App Store</span>
                </div>
              </a>
              <a href="#" className="flex items-center justify-center gap-3 bg-secondary border border-border text-secondary-foreground px-6 py-4 rounded-xl font-bold text-lg hover:bg-secondary/80 transition-all hover:scale-105 active:scale-95">
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
            <h2 className="text-3xl md:text-5xl font-bold mb-6">Drive with absolute clarity.</h2>
            <p className="text-lg text-muted-foreground">
              Built specifically for everyday Kenyan driving. No cluttered maps, no unnecessary noise. Just the alerts that matter.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: <ShieldAlert className="w-6 h-6 text-primary" />,
                title: "Speed Cameras",
                desc: "Get notified well before you approach fixed and known mobile speed camera locations on highways."
              },
              {
                icon: <AlertTriangle className="w-6 h-6 text-primary" />,
                title: "Police Checkpoints",
                desc: "Real-time crowd-sourced alerts for roadblocks and random checks across major routes."
              },
              {
                icon: <Zap className="w-6 h-6 text-primary" />,
                title: "Speed Zones",
                desc: "Sudden drop from 100 to 50 km/h? Msafiri warns you before you miss the sign."
              },
              {
                icon: <RadioTower className="w-6 h-6 text-primary" />,
                title: "Live Community Data",
                desc: "Thousands of drivers reporting in real-time to keep the network accurate and fresh."
              },
              {
                icon: <BellRing className="w-6 h-6 text-primary" />,
                title: "Audio Only Mode",
                desc: "Keeps running in the background. It speaks up over your music only when needed."
              },
              {
                icon: <MapPin className="w-6 h-6 text-primary" />,
                title: "Works with Maps",
                desc: "Run Msafiri seamlessly alongside Google Maps or Waze without interference."
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
            <h2 className="text-3xl md:text-5xl font-bold mb-4">See it in action.</h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Every screen, designed to keep your eyes on the road.
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
              A calm co-pilot for chaotic roads.
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              We know what driving in Kenya feels like. The sudden speed bumps, the hidden cameras on Waiyaki Way, the unpredictable speed zone changes.
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
                <div className="text-4xl font-bold font-mono">KES 150<span className="text-xl text-muted-foreground">/wk</span></div>
                <p className="text-sm text-primary mt-1">1-day free trial included</p>
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
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Questions?</h2>
            <p className="text-lg text-muted-foreground">
              Everything you need to know about Msafiri.
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

      {/* CTA / Download */}
      <section className="py-24 px-6 relative overflow-hidden border-t border-border">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl md:text-6xl font-bold mb-6">Ready to drive smarter?</h2>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Join over 50,000 drivers in Kenya who trust Msafiri every day. Download now and take back control of your journey.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a href="#" className="flex items-center justify-center gap-3 bg-foreground text-background px-8 py-4 rounded-xl font-bold text-lg hover:bg-foreground/90 transition-all hover:scale-105 active:scale-95">
              <Apple className="w-6 h-6 fill-current" />
              <div className="flex flex-col items-start leading-none">
                <span className="text-[10px] font-medium uppercase tracking-wider text-background/60">Download on the</span>
                <span>App Store</span>
              </div>
            </a>
            <a href="#" className="flex items-center justify-center gap-3 bg-secondary border border-border text-secondary-foreground px-8 py-4 rounded-xl font-bold text-lg hover:bg-secondary/80 transition-all hover:scale-105 active:scale-95">
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
            <Navigation className="w-5 h-5 text-primary fill-current" />
            <span className="font-bold text-xl tracking-tight">Msafiri</span>
          </div>
          
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground font-medium">
            <a href="/marketing/about" className="hover:text-foreground transition-colors">About</a>
            <a href="/marketing/contact" className="hover:text-foreground transition-colors">Contact</a>
            <a href="/marketing/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="/marketing/terms" className="hover:text-foreground transition-colors">Terms of Service</a>
          </div>

          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Msafiri Kenya. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
