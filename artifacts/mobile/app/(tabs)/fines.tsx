import React, { useState } from "react";
import { FLAT_LIST_PROPS } from "@/lib/scrollProps";
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  FINE_CATEGORIES,
  PAYMENT_METHODS,
  CONTEST_STEPS,
  ENFORCEMENT_STEPS,
  Fine,
} from "@/data/fines";

type Section = "fines" | "pay" | "contest";

const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  speeding:  { icon: "speedometer-outline",   color: "#E53935" },
  documents: { icon: "document-text-outline",  color: "#1565C0" },
  traffic:   { icon: "warning-outline",        color: "#F57C00" },
  parking:   { icon: "car-outline",            color: "#6A1B9A" },
};

export default function FinesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<Section>("fines");
  const [activeCat, setActiveCat] = useState("speeding");
  const [search, setSearch] = useState("");
  const [expandedPay, setExpandedPay] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const currentCat = FINE_CATEGORIES.find((cat) => cat.id === activeCat);
  const fines: Fine[] = currentCat
    ? search.length > 1
      ? currentCat.fines.filter((f) =>
          f.offence.toLowerCase().includes(search.toLowerCase())
        )
      : currentCat.fines
    : [];

  const formatAmount = (f: Fine): string => {
    if (f.isWarning) return "Warning";
    if (f.isCourt) return "Court";
    return `Ksh ${f.amount.toLocaleString("en-KE")}`;
  };

  const amountColor = (f: Fine): string => {
    if (f.isWarning) return "#F57C00";
    if (f.isCourt) return "#6A1B9A";
    return c.speedDanger;
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <Text style={[styles.title, { color: c.foreground }]}>NTSA Fines</Text>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          NTSA 2025 Schedule & Traffic Act
        </Text>

        {/* Section tabs */}
        <View style={[styles.sectionRow, { backgroundColor: c.muted }]}>
          {(["fines", "pay", "contest"] as Section[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.sectionBtn, section === s && { backgroundColor: c.card }]}
              onPress={() => setSection(s)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.sectionLabel,
                  { color: section === s ? c.primary : c.mutedForeground },
                  section === s && { fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {s === "fines" ? "Fines" : s === "pay" ? "How to Pay" : "Contest"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Fines tab ── */}
      {section === "fines" && (
        <>
          {/* Category chips */}
          <View style={styles.catRow}>
            {FINE_CATEGORIES.map((cat) => {
              const meta = CATEGORY_META[cat.id] ?? { icon: "list-outline", color: c.primary };
              const active = activeCat === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: active ? meta.color + "18" : c.muted,
                      borderColor: active ? meta.color : c.border,
                    },
                  ]}
                  onPress={() => { setActiveCat(cat.id); setSearch(""); }}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={meta.icon as "car-outline"}
                    size={14}
                    color={active ? meta.color : c.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.catChipLabel,
                      { color: active ? meta.color : c.mutedForeground },
                      active && { fontFamily: "Inter_600SemiBold" },
                    ]}
                    numberOfLines={1}
                  >
                    {cat.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Search */}
          <View
            style={[
              styles.searchRow,
              { backgroundColor: c.muted, borderColor: c.border, marginHorizontal: 16, marginBottom: 8 },
            ]}
          >
            <Ionicons name="search-outline" size={15} color={c.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: c.foreground }]}
              placeholder="Search offences…"
              placeholderTextColor={c.mutedForeground}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={15} color={c.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            {...FLAT_LIST_PROPS}
            data={fines}
            keyExtractor={(f) => f.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 100 }}
            ListHeaderComponent={
              activeCat === "speeding" ? (
                <View style={[styles.speedNote, { backgroundColor: "#E53935" + "12", borderColor: "#E53935" + "30" }]}>
                  <Ionicons name="information-circle-outline" size={15} color="#E53935" />
                  <Text style={[styles.speedNoteText, { color: "#E53935" }]}>
                    NTSA 2025 instant-fine schedule. Fines are issued automatically via camera and matched to your plate through TIMS. Pay within 7 days to avoid court.
                  </Text>
                </View>
              ) : null
            }
            ItemSeparatorComponent={() => (
              <View style={[styles.sep, { backgroundColor: c.border }]} />
            )}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.fineRow,
                  { backgroundColor: c.card },
                  item.isCourt && { borderLeftWidth: 3, borderLeftColor: "#6A1B9A" },
                  item.isWarning && { borderLeftWidth: 3, borderLeftColor: "#F57C00" },
                ]}
              >
                <View style={styles.fineLeft}>
                  <Text style={[styles.offence, { color: c.foreground }]}>{item.offence}</Text>
                  <Text style={[styles.fineSection, { color: c.mutedForeground }]}>{item.section}</Text>
                  {item.note != null && (
                    <Text style={[styles.fineNote, { color: c.mutedForeground }]}>{item.note}</Text>
                  )}
                  {item.points != null && item.points > 0 && (
                    <View style={[styles.pointsBadge, { backgroundColor: c.speedDanger + "22" }]}>
                      <Text style={[styles.pointsText, { color: c.speedDanger }]}>
                        {item.points} demerit {item.points === 1 ? "pt" : "pts"}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={[
                  styles.amountBadge,
                  {
                    backgroundColor: amountColor(item) + "15",
                    borderColor: amountColor(item) + "30",
                  },
                ]}>
                  <Text style={[styles.amount, { color: amountColor(item) }]}>
                    {formatAmount(item)}
                  </Text>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                  No matching offences
                </Text>
              </View>
            }
          />
        </>
      )}

      {/* ── How to Pay tab ── */}
      {section === "pay" && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomInset + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* How automated enforcement works */}
          <Text style={[styles.sectionHeading, { color: c.foreground }]}>How It Works</Text>
          {ENFORCEMENT_STEPS.map((step, i) => (
            <View key={i} style={[styles.enforcementCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={[styles.enforcementIcon, { backgroundColor: c.primary + "18" }]}>
                <Ionicons name={step.icon as "camera-outline"} size={20} color={c.primary} />
              </View>
              <View style={styles.enforcementBody}>
                <Text style={[styles.enforcementTitle, { color: c.foreground }]}>{step.title}</Text>
                <Text style={[styles.enforcementDetail, { color: c.mutedForeground }]}>{step.detail}</Text>
              </View>
            </View>
          ))}

          <Text style={[styles.infoNote, { backgroundColor: c.muted, color: c.mutedForeground, marginTop: 8 }]}>
            You have 7 days from receiving the NTSA notice to pay or dispute. Missing this window may result in additional penalties.
          </Text>

          {/* Payment methods */}
          <Text style={[styles.sectionHeading, { color: c.foreground, marginTop: 8 }]}>Payment Methods</Text>
          {PAYMENT_METHODS.map((m) => (
            <View key={m.name} style={[styles.payCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <TouchableOpacity
                style={styles.payHeader}
                onPress={() => setExpandedPay(expandedPay === m.name ? null : m.name)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.payTitle, { color: c.foreground }]}>{m.name}</Text>
                  <Text style={[styles.payDetail, { color: c.mutedForeground }]}>{m.details}</Text>
                </View>
                <Ionicons
                  name={expandedPay === m.name ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={c.mutedForeground}
                />
              </TouchableOpacity>
              {expandedPay === m.name && (
                <View style={[styles.stepsWrap, { borderTopColor: c.border }]}>
                  {m.steps.map((step, i) => (
                    <View key={i} style={styles.step}>
                      <View style={[styles.stepNum, { backgroundColor: c.primary }]}>
                        <Text style={[styles.stepNumText, { color: c.primaryForeground }]}>{i + 1}</Text>
                      </View>
                      <Text style={[styles.stepText, { color: c.foreground }]}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Contest tab ── */}
      {section === "contest" && (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomInset + 100 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.infoNote, { backgroundColor: c.muted, color: c.mutedForeground }]}>
            You have the right to contest any fine you believe was issued in error. You must file within 7 days of receiving the NTSA notice.
          </Text>
          <View style={[styles.payCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.payTitle, { color: c.foreground, marginBottom: 14 }]}>
              Steps to Contest a Fine
            </Text>
            {CONTEST_STEPS.map((step, i) => (
              <View key={i} style={[styles.step, { marginBottom: 14 }]}>
                <View style={[styles.stepNum, { backgroundColor: c.primary }]}>
                  <Text style={[styles.stepNumText, { color: c.primaryForeground }]}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepText, { color: c.foreground }]}>{step}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.infoNote, { backgroundColor: c.muted, marginTop: 0 }]}>
            <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 6 }}>
              Need Legal Help?
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13, marginBottom: 2 }}>
              Law Society of Kenya (LSK)
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13, marginBottom: 2 }}>
              Lavington, Opposite Valley Arcade, Gitanga Road
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13, marginBottom: 2 }}>
              P.O Box 72219-00200, Nairobi, Kenya
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13, marginBottom: 2 }}>
              📞 +254-799-595-800
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13 }}>
              ✉️  lsk@lsk.or.ke
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2, marginBottom: 12 },
  sectionRow: { flexDirection: "row", borderRadius: 12, padding: 4 },
  sectionBtn: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 10 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  catRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  catChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  catChipLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  speedNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 10,
  },
  speedNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  sep: { height: 1 },
  fineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  fineLeft: { flex: 1 },
  offence: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  fineSection: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  fineNote: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 16, fontStyle: "italic" },
  pointsBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  pointsText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  amountBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginTop: 2,
    minWidth: 72,
    alignItems: "center",
  },
  amount: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  empty: { alignItems: "center", paddingTop: 40 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sectionHeading: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 10,
  },
  enforcementCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  enforcementIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  enforcementBody: { flex: 1 },
  enforcementTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  enforcementDetail: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  infoNote: {
    borderRadius: 12,
    padding: 13,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
  payCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  payHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    gap: 12,
  },
  payTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  payDetail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  stepsWrap: { borderTopWidth: 1, padding: 13, gap: 10 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  stepNumText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
