// Per-tab error boundary — isolates a crash in this tab from the other tabs
// and the navigation shell. Expo Router picks this up automatically.
export { ErrorBoundary } from "@/components/ErrorBoundary";

import React, { useEffect, useRef, useState } from "react";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
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
import { formatTimeAgo as timeAgo } from "@/lib/timeAgo";
import { telemetryEnabled, sendTelemetryTestError } from "@/utils/telemetry";
import { listSavedPlaces, type SavedPlace } from "@/utils/tripsApi";

export default function SettingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    hudMode, setHudMode, sosContact, setSosContact, clearTripHistory,
    communityReports, deleteReport, updateReport, flagReport,
    themeOverride, setThemeOverride,
    vehicleType, setVehicleType,
    clearAllData,
    driverName, setDriverName,
    deviceId,
  } = useApp();

  const { isSubscribed } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const [name, setName] = useState(sosContact?.name ?? "");
  const [phone, setPhone] = useState(sosContact?.phone ?? "");
  const [driverNameInput, setDriverNameInput] = useState(driverName);
  const [driverNameSaved, setDriverNameSaved] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSpeed, setEditSpeed] = useState("");
  const [flaggingReportId, setFlaggingReportId] = useState<string | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);


  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    setName(sosContact?.name ?? "");
    setPhone(sosContact?.phone ?? "");
  }, [sosContact]);

  // Load saved places so we can show current Home / Work addresses
  useEffect(() => {
    if (!deviceId) return;
    listSavedPlaces(deviceId).then(setSavedPlaces).catch(() => {});
  }, [deviceId]);

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

  // Once a report has been confirmed by other drivers it's protected — the
  // reporting device can no longer remove it unilaterally, only a moderator
  // can. This is the escalation path for "this is wrong, please review it".
  const promptFlagOwnReport = (report: CommunityReport) => {
    Alert.alert(
      "Report to moderators",
      "Other drivers have confirmed this report, so only our moderation team can remove it. Tell us why it should be reviewed:",
      [
        { text: "It's inaccurate", onPress: () => submitOwnFlag(report.id, "inaccurate_location") },
        { text: "It's gone now", onPress: () => submitOwnFlag(report.id, "already_gone") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const submitOwnFlag = async (id: string, reason: string) => {
    setFlaggingReportId(id);
    const ok = await flagReport(id, reason);
    setFlaggingReportId(null);
    Alert.alert(
      ok ? "Reported" : "Couldn't send report",
      ok ? "Thanks — our moderation team will review this report." : "Check your connection and try again."
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

  const handleShareApp = () => {
    Share.share({
      title: "Msafiri Kenya — Drive Smarter",
      message:
        "Drive smarter with Msafiri Kenya 🚗\n\n" +
        "Get real-time speed camera alerts, police checkpoint warnings, and live traffic incidents before you reach them.\n\n" +
        "📱 iOS: https://apps.apple.com/us/app/msafiri-kenya/id6789483834\n\n" +
        "🤖 Android: https://play.google.com/store/apps/details?id=com.msafiri.kenya",
    });
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

      {/* Subscription banner */}
      {isSubscribed ? (
        <View style={[styles.proBanner, { backgroundColor: c.primary + "18", borderColor: c.primary + "44" }]}>
          <Ionicons name="shield-checkmark" size={20} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.proBannerTitle, { color: c.foreground }]}>Msafiri</Text>
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
            <Text style={[styles.proBannerTitle, { color: c.primaryForeground }]}>Subscribe to Msafiri</Text>
            <Text style={[styles.proBannerSub, { color: c.primaryForeground + "CC" }]}>
              From KES 100/week · 3-day free trial
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.primaryForeground + "CC"} />
        </TouchableOpacity>
      )}

      {/* Driving Course / Learn */}
      <TouchableOpacity
        style={[styles.proBanner, { backgroundColor: c.card, borderColor: c.border }]}
        onPress={() => router.push("/(tabs)/learn" as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="book-outline" size={20} color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.proBannerTitle, { color: c.foreground }]}>Driving Course</Text>
          <Text style={[styles.proBannerSub, { color: c.mutedForeground }]}>
            Lessons, quizzes &amp; practice tests
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
      </TouchableOpacity>

      {/* Creator Program */}
      <TouchableOpacity
        style={[styles.proBanner, { backgroundColor: c.card, borderColor: c.border }]}
        onPress={() => router.push("/creator-program" as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="star-outline" size={20} color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.proBannerTitle, { color: c.foreground }]}>Msafiri Creator Program</Text>
          <Text style={[styles.proBannerSub, { color: c.mutedForeground }]}>
            Report incidents · Get 1 month free
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
      </TouchableOpacity>

      {/* Driver name for live sharing */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>LIVE SHARING</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardLabel, { color: c.mutedForeground }]}>
            Your name shown to people you share your live location with — e.g. "John is sharing their location".
          </Text>
          <View style={[styles.inputRow, { borderColor: c.border }]}>
            <Ionicons name="person-circle-outline" size={18} color={c.mutedForeground} />
            <TextInput
              style={[styles.input, { color: c.foreground }]}
              placeholder="Your first name (optional)"
              placeholderTextColor={c.mutedForeground}
              value={driverNameInput}
              onChangeText={setDriverNameInput}
              returnKeyType="done"
              maxLength={40}
            />
          </View>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: driverNameSaved ? c.speedSafe : c.primary }]}
            onPress={() => {
              setDriverName(driverNameInput);
              setDriverNameSaved(true);
              setTimeout(() => setDriverNameSaved(false), 2000);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
          >
            <Ionicons name={driverNameSaved ? "checkmark" : "save-outline"} size={16} color={c.primaryForeground} />
            <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
              {driverNameSaved ? "Saved!" : "Save Name"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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
                    {isProtected && (
                      <Text style={[styles.protectedHint, { color: c.mutedForeground }]}>
                        Confirmed by other drivers — only moderators can remove it. Tap the flag to report it.
                      </Text>
                    )}
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
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: "#1565C014" }]}
                        disabled={flaggingReportId === report.id}
                        onPress={() => promptFlagOwnReport(report)}
                      >
                        <Ionicons name="flag-outline" size={14} color={flaggingReportId === report.id ? c.mutedForeground : "#1565C0"} />
                      </TouchableOpacity>
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

      {/* My Places — Home, Work, custom saved locations */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>MY PLACES</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: 0, overflow: "hidden" }]}>
          {/* Home */}
          {(() => {
            const home = savedPlaces.find(p => p.kind === "home");
            return (
              <Row
                label="Home"
                icon="home"
                value={home ? (home.address ?? home.label) : "Not set"}
                onPress={() => router.push("/(tabs)/trips")}
              />
            );
          })()}
          {/* Work */}
          {(() => {
            const work = savedPlaces.find(p => p.kind === "work");
            return (
              <Row
                label="Work"
                icon="briefcase"
                value={work ? (work.address ?? work.label) : "Not set"}
                onPress={() => router.push("/(tabs)/trips")}
              />
            );
          })()}
          {/* Custom places */}
          <Row
            label={`Other saved places${savedPlaces.filter(p => p.kind === "custom").length > 0 ? ` (${savedPlaces.filter(p => p.kind === "custom").length})` : ""}`}
            icon="star-outline"
            onPress={() => router.push("/(tabs)/trips")}
          />
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

      {/* Share App */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>SHARE APP</Text>
        <TouchableOpacity
          style={[styles.shareAppBtn, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={handleShareApp}
          activeOpacity={0.8}
        >
          <View style={[styles.shareAppIcon, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="share-social-outline" size={22} color={c.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.shareAppTitle, { color: c.foreground }]}>Share Msafiri</Text>
            <Text style={[styles.shareAppSub, { color: c.mutedForeground }]}>
              Send friends the iOS &amp; Android download links
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Crash reporting — shown only when Sentry DSN is configured */}
      {telemetryEnabled() && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>CRASH REPORTING</Text>
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: 0, overflow: "hidden" }]}>
            <Row
              label="Send Test Crash Report"
              icon="bug-outline"
              onPress={() => {
                const sent = sendTelemetryTestError();
                Alert.alert(
                  sent ? "Test event sent" : "Telemetry not active",
                  sent
                    ? "A test error was sent to Sentry. It should appear in your dashboard within a few seconds."
                    : "Sentry is not initialised — check that EXPO_PUBLIC_SENTRY_DSN is set in this build.",
                );
              }}
            />
          </View>
        </View>
      )}

      {/* About */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: 0, overflow: "hidden" }]}>
          <Row label="About Msafiri"    icon="information-circle-outline" onPress={() => router.push("/about")} />
          <Row label="Msafiri Blog"     icon="newspaper-outline"          onPress={() => router.push("/blogs")} />
          <Row label="Contact Us"       icon="mail-outline"               onPress={() => router.push("/contact")} />
          <Row label="Privacy Policy"   icon="shield-outline"             onPress={() => router.push("/privacy")} />
          <Row label="Terms of Service" icon="document-text-outline"      onPress={() => router.push("/terms")} />
        </View>
        {/* Version — hidden 7-tap gesture unlocks Reviewer Mode for store reviewers */}
        <View style={{ alignItems: "center", paddingVertical: 14 }}>
          <Text style={[styles.aboutVersion, { color: c.mutedForeground }]}>
            Msafiri Kenya v{Constants.expoConfig?.version ?? "1.0.0"}
          </Text>
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
  protectedHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
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

  // Share App
  shareAppBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1,
  },
  shareAppIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  shareAppTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  shareAppSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
