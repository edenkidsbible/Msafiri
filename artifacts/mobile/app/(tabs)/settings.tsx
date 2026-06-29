import React, { useEffect, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import type { CommunityReport } from "@/context/AppContext";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function reportLabel(type: CommunityReport["type"]): string {
  return type === "camera"    ? "Speed Camera"
       : type === "police"    ? "Police Checkpoint"
       : type === "accident"  ? "Accident"
       : type === "pothole"   ? "Pothole"
       : type === "roadblock" ? "Road Block"
                              : "Clear Road";
}

function reportIcon(type: CommunityReport["type"]): React.ComponentProps<typeof Ionicons>["name"] {
  return type === "camera"    ? "camera"
       : type === "police"    ? "shield-checkmark"
       : type === "accident"  ? "warning"
       : type === "pothole"   ? "alert-circle"
       : type === "roadblock" ? "ban"
                              : "checkmark-circle";
}

function reportIconColor(type: CommunityReport["type"]): string {
  return type === "camera"    ? "#E53935"
       : type === "police"    ? "#1565C0"
       : type === "accident"  ? "#E65100"
       : type === "pothole"   ? "#6A1B9A"
       : type === "roadblock" ? "#BF360C"
                              : "#2E7D32";
}

export default function SettingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    hudMode, setHudMode, sosContact, setSosContact, clearTripHistory,
    communityReports, deleteReport, updateReport,
  } = useApp();

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
      `Remove your ${reportLabel(report.type)} report? This cannot be undone.`,
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
    <ScrollView
      style={[styles.screen, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: bottomInset + 40, paddingTop: topInset + 12 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: c.foreground }]}>Settings</Text>

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
              const iconColor = reportIconColor(report.type);
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
                  <View style={[styles.reportIconWrap, { backgroundColor: iconColor + "18" }]}>
                    <Ionicons name={reportIcon(report.type)} size={18} color={iconColor} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.reportType, { color: c.foreground }]}>
                      {reportLabel(report.type)}
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

      {/* Display */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>DISPLAY</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
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

      {/* About */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.aboutApp, { color: c.foreground }]}>SafeDrive Kenya</Text>
          <Text style={[styles.aboutVersion, { color: c.mutedForeground }]}>Version 1.0.0</Text>
          <Text style={[styles.aboutDesc, { color: c.mutedForeground }]}>
            Real-time speed awareness for Kenyan roads. Data is for guidance only — always obey
            all traffic signs and regulations.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", paddingHorizontal: 20, marginBottom: 24 },
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
});
