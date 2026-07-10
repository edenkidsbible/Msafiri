import React, { useEffect, useState } from "react";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import type { CommunityReport } from "@/context/AppContext";
import { useSubscription } from "@/lib/revenuecat";
import { PaywallModal } from "@/components/PaywallModal";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { VEHICLE_TYPES } from "@/data/vehicleTypes";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}


export default function SettingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    hudMode, setHudMode, sosContact, setSosContact, clearTripHistory,
    communityReports, deleteReport, updateReport,
    themeOverride, setThemeOverride,
    vehicleType, setVehicleType,
    clearAllData,
  } = useApp();

  const { isSubscribed } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const [name, setName] = useState(sosContact?.name ?? "");
  const [phone, setPhone] = useState(sosContact?.phone ?? "");
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSpeed, setEditSpeed] = useState("");

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    setName(sosContact?.name ?? "");
    setPhone(sosContact?.phone ?? "");
  }, [sosContact]);

  const saveContact = () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert("Incomplete", "Please enter both a name and a phone number.");
      return;
    }
    setSosContact({ name: name.trim(), phone: phone.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const clearContact = () => {
    Alert.alert("Remove Contact", "Remove your emergency SOS contact?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setSosContact(null);
          setName("");
          setPhone("");
        },
      },
    ]);
  };

  const clearHistory = () => {
    Alert.alert("Clear Trips", "Remove all trip history? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: clearTripHistory },
    ]);
  };

  const confirmDelete = (report: CommunityReport) => {
    Alert.alert(
      "Remove Report",
      `Remove your ${resolveIncidentType(report.type).label} report? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deleteReport(report.id),
        },
      ]
    );
  };

  const saveSpeedEdit = (report: CommunityReport) => {
    const val = parseInt(editSpeed, 10);
    if (isNaN(val) || val < 10 || val > 200) {
      Alert.alert("Invalid", "Enter a speed limit between 10 and 200 km/h.");
      return;
    }
    updateReport(report.id, val);
    setEditingId(null);
    setEditSpeed("");
  };

  const ownReports = communityReports.filter((r) => r.isOwn);

  const Row = ({
    label, value, icon, onPress, danger,
  }: {
    label: string; value?: string; icon: string; onPress: () => void; danger?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon as "trash"} size={20} color={danger ? c.speedDanger : c.primary} />
      <Text style={[styles.rowLabel, { color: danger ? c.speedDanger : c.foreground }]}>{label}</Text>
      {value && <Text style={[styles.rowValue, { color: c.mutedForeground }]}>{value}</Text>}
      <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
    </TouchableOpacity>
  );

  return (
    <>
    <ScrollView
      {...SCROLL_PROPS}
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: bottomInset + 40, paddingTop: topInset + 12 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageTitleRow}>
        <TouchableOpacity
          onPress={() => router.navigate("/(tabs)")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.pageTitle, { color: c.foreground }]}>Settings</Text>
      </View>

      {/* Pro subscription banner */}
      {isSubscribed ? (
        <View style={[styles.proBanner, { backgroundColor: c.primary + "18", borderColor: c.primary + "44" }]}>
          <Ionicons name="shield-checkmark" size={20} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.proBannerTitle, { color: c.foreground }]}>Msafiri Pro</Text>
            <Text style={[styles.proBannerSub, { color: c.mutedForeground }]}>Your subscription is active</Text>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.proBanner, { backgroundColor: c.primary, borderColor: "transparent" }]}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={c.primaryForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.proBannerTitle, { color: c.primaryForeground }]}>Upgrade to Msafiri Pro</Text>
            <Text style={[styles.proBannerSub, { color: c.primaryForeground + "CC" }]}>
              From KES 100/week · 3-day free trial
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.primaryForeground + "CC"} />
        </TouchableOpacity>
      )}

      {/* SOS Contact */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>EMERGENCY SOS</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardLabel, { color: c.mutedForeground }]}>
            Set an emergency contact. One tap sends them your GPS location via SMS.
          </Text>
          <View style={[styles.inputRow, { borderColor: c.border }]}>
            <Ionicons name="person-outline" size={18} color={c.mutedForeground} />
            <TextInput
              style={[styles.input, { color: c.foreground }]}
              placeholder="Contact name"
              placeholderTextColor={c.mutedForeground}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />
          </View>
          <View style={[styles.inputRow, { borderColor: c.border }]}>
            <Ionicons name="call-outline" size={18} color={c.mutedForeground} />
            <TextInput
              style={[styles.input, { color: c.foreground }]}
              placeholder="+254 7XX XXX XXX"
              placeholderTextColor={c.mutedForeground}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              returnKeyType="done"
            />
          </View>
          <View style={styles.contactActions}>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: saved ? c.speedSafe : c.primary }]}
              onPress={saveContact}
            >
              <Ionicons name={saved ? "checkmark" : "save-outline"} size={16} color={c.primaryForeground} />
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {saved ? "Saved!" : "Save Contact"}
              </Text>
            </TouchableOpacity>
            {sosContact && (
              <TouchableOpacity style={[styles.removeBtn, { borderColor: c.border }]} onPress={clearContact}>
                <Ionicons name="trash-outline" size={16} color={c.speedDanger} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* My Reports */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>MY REPORTS</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: 0, overflow: "hidden" }]}>
          {ownReports.length === 0 ? (
            <View style={styles.emptyReports}>
              <Ionicons name="flag-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyReportsTxt, { color: c.mutedForeground }]}>
                You have not submitted any reports yet.
              </Text>
            </View>
          ) : (
            ownReports.map((report, idx) => {
              const isProtected = (report.confirmCount ?? 1) >= 3;
              const def = resolveIncidentType(report.type);
              const isEditing = editingId === report.id;

              return (
                <View
                  key={report.id}
                  style={[
                    styles.reportItem,
                    { borderBottomColor: c.border },
                    idx === ownReports.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  {/* Main row */}
                  <View style={[styles.reportIconWrap, { backgroundColor: def.color + "18" }]}>
                    {def.iconSet === "MaterialCommunityIcons" ? (
                      <MaterialCommunityIcons name={def.icon as any} size={18} color={def.color} />
                    ) : (
                      <Ionicons name={def.icon as any} size={18} color={def.color} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.reportType, { color: c.foreground }]}>
                      {def.label}
                      {report.speedLimit ? `  ·  ${report.speedLimit} km/h` : ""}
                    </Text>
                    <View style={styles.reportMeta}>
                      <Text style={[styles.reportTime, { color: c.mutedForeground }]}>
                        {timeAgo(report.timestamp)}
                      </Text>
                      {(report.confirmCount ?? 1) > 1 && (
                        <View style={[styles.confirmBadge, { backgroundColor: "#00C85318" }]}>
                          <Ionicons name="thumbs-up" size={10} color="#00C853" />
                          <Text style={[styles.confirmTxt, { color: "#00C853" }]}>
                            {(report.confirmCount ?? 1) - 1} confirmed
                          </Text>
                        </View>
                      )}
                      {isProtected && (
                        <View style={[styles.confirmBadge, { backgroundColor: "#1565C018" }]}>
                          <Ionicons name="shield-checkmark" size={10} color="#1565C0" />
                          <Text style={[styles.confirmTxt, { color: "#1565C0" }]}>Protected</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Action buttons */}
                  <View style={styles.reportActions}>
                    {report.type === "camera" && !isEditing && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: c.muted }]}
                        onPress={() => {
                          setEditingId(report.id);
                          setEditSpeed(report.speedLimit ? String(report.speedLimit) : "");
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                      >
                        <Ionicons name="pencil" size={14} color={c.primary} />
                      </TouchableOpacity>
                    )}
                    {isProtected ? (
                      <View style={[styles.actionBtn, { backgroundColor: c.muted, opacity: 0.5 }]}>
                        <Ionicons name="lock-closed" size={14} color={c.mutedForeground} />
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: "#E5393514" }]}
                        onPress={() => confirmDelete(report)}
                      >
                        <Ionicons name="trash-outline" size={14} color={c.speedDanger} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Inline speed-limit editor (camera only) */}
                  {isEditing && (
                    <View style={[styles.speedEditor, { borderTopColor: c.border, backgroundColor: c.background }]}>
                      <Text style={[styles.speedEditorLabel, { color: c.mutedForeground }]}>
                        Correct speed limit (km/h):
                      </Text>
                      <View style={styles.speedEditorRow}>
                        <TextInput
                          style={[styles.speedEditorInput, { borderColor: c.border, color: c.foreground, backgroundColor: c.card }]}
                          value={editSpeed}
                          onChangeText={setEditSpeed}
                          keyboardType="number-pad"
                          placeholder="e.g. 60"
                          placeholderTextColor={c.mutedForeground}
                          autoFocus
                          returnKeyType="done"
                          onSubmitEditing={() => saveSpeedEdit(report)}
                        />
                        <TouchableOpacity
                          style={[styles.speedSaveBtn, { backgroundColor: c.primary }]}
                          onPress={() => saveSpeedEdit(report)}
                        >
                          <Text style={styles.speedSaveTxt}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.speedCancelBtn, { borderColor: c.border }]}
                          onPress={() => { setEditingId(null); setEditSpeed(""); }}
                        >
                          <Text style={[styles.speedCancelTxt, { color: c.mutedForeground }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      </View>

      {/* Trip History */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>TRIP HISTORY</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: 0, overflow: "hidden" }]}>
          <Row
            label="View Trip History"
            icon="time-outline"
            onPress={() => router.push("/(tabs)/trips")}
          />
        </View>
      </View>

      {/* Vehicle Type */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>VEHICLE TYPE</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardLabel, { color: c.mutedForeground }]}>
            Speed limits in Kenya vary by vehicle class. We'll show you the correct limit for your vehicle at every zone.
          </Text>
          <View style={styles.vehicleTypeGrid}>
            {VEHICLE_TYPES.map((v) => {
              const active = vehicleType === v.id;
              const IconComponent = v.iconSet === "Ionicons" ? Ionicons : MaterialCommunityIcons;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[
                    styles.vehicleTypeBtn,
                    {
                      backgroundColor: active ? c.primary : c.muted,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                  onPress={() => {
                    setVehicleType(v.id);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  activeOpacity={0.75}
                >
                  <IconComponent
                    name={v.icon as any}
                    size={18}
                    color={active ? c.primaryForeground : c.mutedForeground}
                  />
                  <Text style={[styles.vehicleTypeBtnText, { color: active ? c.primaryForeground : c.mutedForeground }]}>
                    {v.shortLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Display */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>DISPLAY</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {/* Appearance */}
          <View style={{ gap: 10 }}>
            <Text style={[styles.toggleLabel, { color: c.foreground }]}>Appearance</Text>
            <View style={styles.themeRow}>
              {(["system", "light", "dark"] as const).map((opt) => {
                const active = themeOverride === opt;
                const label = opt === "system" ? "Auto" : opt === "light" ? "Light" : "Dark";
                const icon  = opt === "system" ? "phone-portrait-outline" : opt === "light" ? "sunny-outline" : "moon-outline";
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.themeBtn,
                      {
                        backgroundColor: active ? c.primary : c.muted,
                        borderColor: active ? c.primary : c.border,
                      },
                    ]}
                    onPress={() => {
                      setThemeOverride(opt);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={icon as any}
                      size={16}
                      color={active ? c.primaryForeground : c.mutedForeground}
                    />
                    <Text style={[styles.themeBtnText, { color: active ? c.primaryForeground : c.mutedForeground }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />

          {/* HUD mode */}
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: c.foreground }]}>HUD / Night Mode</Text>
              <Text style={[styles.toggleSub, { color: c.mutedForeground }]}>
                High-contrast display, keeps screen on while driving
              </Text>
            </View>
            <Switch
              value={hudMode}
              onValueChange={(v) => {
                setHudMode(v);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              trackColor={{ false: c.border, true: c.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>
      </View>

      {/* Data */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>DATA</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, overflow: "hidden" }]}>
          <Row
            label="Clear Trip History"
            icon="trash-outline"
            onPress={clearHistory}
            danger
          />
        </View>
      </View>

      {/* Privacy & Data */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>PRIVACY & DATA</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardLabel, { color: c.mutedForeground }]}>
            Msafiri stores your trip history, reported incidents, and SOS contact locally on this
            device. No personal account is required. Deleting your data removes everything
            permanently and cannot be undone.
          </Text>
          <TouchableOpacity
            style={[styles.deleteDataBtn, { borderColor: c.destructive + "60", backgroundColor: c.destructive + "10" }]}
            activeOpacity={0.75}
            onPress={() => {
              Alert.alert(
                "Delete All My Data",
                "This will permanently erase your trip history, reported incidents, SOS contact, and all preferences stored on this device. This cannot be undone.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete Everything",
                    style: "destructive",
                    onPress: () => {
                      Alert.alert(
                        "Are you sure?",
                        "Your data will be gone immediately and cannot be recovered.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Yes, Delete",
                            style: "destructive",
                            onPress: async () => {
                              await clearAllData();
                              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                              Alert.alert("Data Deleted", "All your local data has been erased.");
                            },
                          },
                        ]
                      );
                    },
                  },
                ]
              );
            }}
          >
            <Ionicons name="trash" size={16} color={c.destructive} />
            <Text style={[styles.deleteDataBtnText, { color: c.destructive }]}>Delete All My Data</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: 0, overflow: "hidden" }]}>
          <Row label="About Msafiri"    icon="information-circle-outline" onPress={() => router.push("/about")} />
          <Row label="Contact Us"       icon="mail-outline"               onPress={() => router.push("/contact")} />
          <Row label="Privacy Policy"   icon="shield-outline"             onPress={() => router.push("/privacy")} />
          <Row label="Terms of Service" icon="document-text-outline"      onPress={() => router.push("/terms")} />
        </View>
      </View>
    </ScrollView>

    <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pageTitleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, marginBottom: 24, gap: 4 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold" },
  section: { marginBottom: 24, paddingHorizontal: 16 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  cardLabel: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  contactActions: { flexDirection: "row", gap: 10 },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  removeBtn: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
  },
  themeRow: { flexDirection: "row", gap: 8 },
  themeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  vehicleTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vehicleTypeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  vehicleTypeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  dividerLine: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  rowValue: { fontSize: 13, fontFamily: "Inter_400Regular" },
  deleteDataBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  deleteDataBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  aboutApp: { fontSize: 16, fontFamily: "Inter_700Bold" },
  aboutVersion: { fontSize: 13, fontFamily: "Inter_400Regular" },
  aboutDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  // ── My Reports ──────────────────────────────────────────────────────────────
  emptyReports: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  emptyReportsTxt: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  reportItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: "wrap",
  },
  reportIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  reportType: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  reportMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  reportTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  confirmBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  confirmTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  reportActions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  speedEditor: {
    width: "100%",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  speedEditorLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  speedEditorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  speedEditorInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  speedSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  speedSaveTxt: { color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  speedCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  speedCancelTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  proBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 20,
    borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18,
    borderWidth: 1,
  },
  proBannerTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  proBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
