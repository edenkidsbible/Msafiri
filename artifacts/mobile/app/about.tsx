import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

const FEATURES = [
  {
    icon: "speedometer",
    title: "Real-Time Speed Awareness",
    desc: "GPS-based speed display compared against Kenya's actual speed zones — with visual and haptic warnings before you breach a limit.",
  },
  {
    icon: "camera",
    title: "NTSA Speed Camera Alerts",
    desc: "Voice warnings before fixed and mobile NTSA cameras on all major Kenyan highways. Speed-adaptive — alerts come earlier when you're travelling faster.",
  },
  {
    icon: "shield-checkmark",
    title: "Police Checkpoint Warnings",
    desc: "Real-time community alerts for police roadblocks, spot checks, and alcoblow (breathalyser) checkpoints across all 47 counties.",
  },
  {
    icon: "people",
    title: "Community Hazard Reports",
    desc: "Crowd-sourced road conditions — potholes, debris, broken-down vehicles, flooding, poor visibility — reported by drivers and verified in real time.",
  },
  {
    icon: "navigate",
    title: "Turn-by-Turn Navigation",
    desc: "Full route guidance with voice instructions, Kenyan road names, and hazard alerts woven into every step — tailored for local junctions and landmarks.",
  },
  {
    icon: "map",
    title: "Route Hazard Preview",
    desc: "See every camera, checkpoint, and community-reported hazard along your entire route before you set off — so you can plan, not react.",
  },
  {
    icon: "videocam",
    title: "Built-In Dashcam",
    desc: "Continuous background recording while you drive. Clips auto-split, key moments are locked, and footage syncs to cloud on Wi-Fi — no extra device needed.",
  },
  {
    icon: "pulse",
    title: "Crash / Accident Assistant",
    desc: "A guided 7-step accident documentation flow: emergency call, scene photos, witness details, police report, and a PDF export for insurance — even when you can't think clearly.",
  },
  {
    icon: "car",
    title: "Co-Driver & Garage Sharing",
    desc: "Share your vehicle with a co-driver using a secure code. They get full access to the shared vehicle's data and alerts in their own garage — you stay in control.",
  },
  {
    icon: "share-social",
    title: "Live Trip Sharing",
    desc: "One tap creates a link so family or friends can watch your position, speed, and ETA live in any browser — no app download required on their end.",
  },
  {
    icon: "book",
    title: "NTSA Driver Safety Course",
    desc: "Interactive lessons covering Kenya's Highway Code, traffic signs, NTSA fine schedules, and safe driving practices — free for all users.",
  },
  {
    icon: "bookmark",
    title: "Saved Places & Planned Trips",
    desc: "Save Home, Work, and frequent destinations. Plan a trip in advance and get a full hazard briefing — cameras, checkpoints, and road conditions — before you leave.",
  },
  {
    icon: "moon",
    title: "Night HUD Mode",
    desc: "High-contrast full-screen speed and alert display designed for night driving — glance and refocus instantly without straining your eyes.",
  },
  {
    icon: "bar-chart",
    title: "Post-Trip Summary",
    desc: "After every drive: distance, time, speed events, alerts encountered, and driving behaviour insights — to help you understand and improve.",
  },
  {
    icon: "alert-circle",
    title: "SOS Emergency Button",
    desc: "One tap composes an emergency message with your GPS location to pre-configured contacts — ready to send with a single press when seconds matter.",
  },
  {
    icon: "cloud-offline",
    title: "Offline Speed Zone Data",
    desc: "Kenya's full speed zone map is embedded in the app — speed warnings and camera alerts work without a data connection.",
  },
];

const VALUES = [
  {
    icon: "lock-closed",
    title: "Privacy-First",
    desc: "No account required. Your GPS data is processed on-device — we never sell it or use it for advertising.",
  },
  {
    icon: "people",
    title: "Community-Powered",
    desc: "Real road conditions shared by Kenyan drivers, for Kenyan drivers — verified in real time by the community.",
  },
  {
    icon: "flash",
    title: "Real-Time",
    desc: "Speed camera alerts, checkpoint warnings, and hazard reports in the moment they matter — not five minutes later.",
  },
  {
    icon: "heart",
    title: "Built for Kenya",
    desc: "NTSA enforcement patterns, local road names, driving culture — understood from the inside, not retrofitted from abroad.",
  },
  {
    icon: "shield",
    title: "Safety Over Profit",
    desc: "We will never sell your data, compromise your privacy, or water down safety features for ad revenue.",
  },
  {
    icon: "trending-up",
    title: "Always Improving",
    desc: "Every confirmed report and denied false positive makes the map more accurate for every driver on the road.",
  },
];

export default function AboutScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      style={[s.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero ── */}
      <View style={s.hero}>
        <View style={[s.iconBadge, { backgroundColor: c.primary + "18" }]}>
          <Ionicons name="navigate" size={36} color={c.primary} />
        </View>
        <Text style={[s.appName, { color: c.foreground }]}>Msafiri</Text>
        <Text style={[s.version, { color: c.mutedForeground }]}>
          Version {Constants.expoConfig?.version ?? "2.0.0"}
        </Text>
        <Text style={[s.tagline, { color: c.mutedForeground }]}>
          Kenya's most trusted road safety companion — one kilometre at a time.
        </Text>
      </View>

      {/* ── Stats ── */}
      <View style={s.statsGrid}>
        {[
          { num: "50K+", label: "Active drivers" },
          { num: "47",   label: "Counties covered" },
          { num: "13+",  label: "Incident types" },
          { num: "0",    label: "Accounts required" },
        ].map(({ num, label }) => (
          <View key={label} style={[s.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[s.statNum, { color: c.primary }]}>{num}</Text>
            <Text style={[s.statLabel, { color: c.mutedForeground }]}>{label}</Text>
          </View>
        ))}
      </View>

      {/* ── Mission ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>OUR MISSION</Text>
        <Text style={[s.body, { color: c.foreground }]}>
          Kenya loses thousands of lives to road accidents every year. Many of those lives could be saved
          with better information — knowing where a speed trap is, where an alcoblow checkpoint has appeared,
          where a pothole has opened up on a dark highway, where a breakdown is blocking traffic ahead.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>Msafiri</Text>
          {' \u2014 Swahili for \u201ctraveller\u201d \u2014 is our answer. A mobile app that gives every Kenyan driver'
            + ' real-time speed awareness, a community safety map, built-in navigation, a dashcam, a crash'
            + ' documentation tool, and the ability to share their journey safely \u2014 all without requiring'
            + ' an account or surrendering personal data.'}
        </Text>
      </View>

      {/* ── Problem ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>THE PROBLEM WE ARE SOLVING</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          Kenya's roads are some of the most dynamic in Africa. Speed zones change without warning. Police
          checkpoints move daily. Alcoblow operations appear overnight. Potholes open up between map
          updates. Yet most navigation apps treat Kenyan roads as a static overlay from a decade ago.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          Drivers are forced to rely on word of mouth, WhatsApp groups, and instinct. Msafiri turns that
          informal network into a real-time, crowd-verified safety layer — available to every driver,
          without a social account or a compatible car.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          And when accidents happen on Kenyan roads, most drivers don't know what to do. Panic sets in,
          evidence is lost, insurance claims fall apart. The Msafiri Accident Assistant gives every driver
          a guided process — step by step, even when they can't think clearly.
        </Text>
      </View>

      {/* ── How it works ── */}
      <View style={[s.callout, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.calloutTitle, { color: c.foreground }]}>How Msafiri works</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          The app uses your device's GPS to calculate your real-time speed and compare it against known
          speed zones. Other drivers submit road conditions — speed cameras, checkpoints, alcoblow
          operations, potholes, debris — which appear on your map within seconds. A built-in dashcam
          records continuously in the background. Everything happens without requiring you to create an
          account or share personal information.
        </Text>
      </View>

      {/* ── Full Feature Inventory ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>WHAT'S INSIDE THE APP</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          Msafiri is not a single-feature alert tool. It is Kenya's most complete road safety platform —
          built by listening to Kenyan drivers and iterating on real road conditions.
        </Text>
        {FEATURES.map((f) => (
          <View key={f.icon} style={s.featureRow}>
            <View style={[s.featureIcon, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name={f.icon as any} size={16} color={c.primary} />
            </View>
            <View style={s.featureTextGroup}>
              <Text style={[s.featureTitle, { color: c.foreground }]}>{f.title}</Text>
              <Text style={[s.featureDesc, { color: c.mutedForeground }]}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── Values ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>WHAT WE STAND FOR</Text>
        <View style={s.valuesGrid}>
          {VALUES.map((v) => (
            <View key={v.title} style={[s.valueCard, { backgroundColor: c.background, borderColor: c.border }]}>
              <View style={s.valueTitleRow}>
                <Ionicons name={v.icon as any} size={14} color={c.primary} />
                <Text style={[s.valueTitle, { color: c.foreground }]}>{v.title}</Text>
              </View>
              <Text style={[s.valueDesc, { color: c.mutedForeground }]}>{v.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Built in Kenya ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>BUILT IN KENYA, FOR KENYA</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          Msafiri is developed in Nairobi by engineers and road-safety advocates who drive these roads
          every day — on Thika Road in the morning rush, on Mombasa Road after dark, on the Nakuru
          highway at speed. Every design decision reflects those experiences.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          We are not a Silicon Valley product retrofitted to Africa. We are African-built from day one —
          using local NTSA data, listening to Kenyan drivers, and iterating fast based on what actually
          helps people stay safe on roads that most mapping apps still get wrong.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          Every speed zone, camera placement, and fine bracket in the app reflects Kenya's actual traffic
          law — the Traffic (Amendment) Act (LN 161/2016), NTSA enforcement patterns, and the realities
          of road safety in Kenya today.
        </Text>
      </View>

      {/* ── NTSA context ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>SPEED CAMERAS & FINES IN KENYA</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          NTSA operates both fixed and mobile speed cameras across Kenya's highway network. Fixed cameras
          are installed on major roads including Thika Road, Mombasa Road, Waiyaki Way, the Southern
          Bypass, and the Nairobi Expressway. Mobile cameras are deployed at any location without notice.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          Speeding fines under the Traffic (Amendment) Act are tiered: a warning for minor excess, KES 500
          for moderate excess, KES 3,000 for significant excess, KES 10,000 for serious excess. Exceeding
          the speed limit by 21 km/h or more is a court matter — not a roadside fine — and can result in
          licence suspension. Drivers have 7 days to pay before additional penalties apply.
        </Text>
        <Text style={[s.body, { color: c.mutedForeground, marginTop: 4 }]}>
          Msafiri's NTSA Driver Safety Course covers the full fine schedule, speed zone regulations, and
          Kenya's Highway Code — free for all users inside the app.
        </Text>
      </View>

      {/* ── Disclaimer ── */}
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[s.sectionLabel, { color: c.mutedForeground }]}>DISCLAIMER</Text>
        <Text style={[s.body, { color: c.mutedForeground }]}>
          Speed zone and alert data is for guidance only. Always obey official traffic signs, road
          markings, and all applicable Kenyan traffic laws. Msafiri is a supplemental driving awareness
          tool — it does not replace safe, attentive driving.
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },

  // Hero
  hero: { alignItems: "center", paddingHorizontal: 24, marginBottom: 20, gap: 6 },
  iconBadge: {
    width: 76, height: 76, borderRadius: 24,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  appName: { fontSize: 28, fontFamily: "Inter_700Bold" },
  version: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tagline: {
    fontSize: 15, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 22, marginTop: 4,
  },

  // Stats
  statsGrid: {
    flexDirection: "row", flexWrap: "wrap",
    marginHorizontal: 16, marginBottom: 16, gap: 10,
  },
  statCard: {
    flex: 1, minWidth: "44%", borderRadius: 14, borderWidth: 1,
    padding: 16, alignItems: "center", gap: 4,
  },
  statNum: { fontSize: 26, fontFamily: "Inter_800ExtraBold", lineHeight: 30 },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },

  // Cards
  card: {
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 10,
  },
  callout: {
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 16, borderWidth: 1, padding: 16, gap: 8,
  },
  calloutTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Text
  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5,
  },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },

  // Features
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 4 },
  featureIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
  },
  featureTextGroup: { flex: 1, gap: 2 },
  featureTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  featureDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  // Values
  valuesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  valueCard: {
    width: "47%", borderRadius: 12, borderWidth: 1, padding: 12, gap: 6,
  },
  valueTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  valueTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  valueDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
