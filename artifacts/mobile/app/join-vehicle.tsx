import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { apiPost, apiGet } from "@/utils/apiClient";
import { normalizePlate, addSharedVehicle } from "@/utils/savedVehicles";

type Tab = "code" | "plate";

interface FoundVehicle {
  id: string;
  plateNumber: string | null;
  displayName: string;
  vehicleType: string;
}

// ── Privacy disclosure ─────────────────────────────────────────────────────────

function PrivacyDisclosure({ vehicle, onConfirm, onCancel, loading, confirmLabel }: {
  vehicle: FoundVehicle;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  confirmLabel?: string;
}) {
  const c = useColors();
  const plateDisplay = vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : "";

  return (
    <View style={[disc.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[disc.vehicleRow, { backgroundColor: c.primary + "10" }]}>
        <Ionicons name="car-outline" size={20} color={c.primary} />
        <Text style={[disc.vehicleName, { color: c.foreground }]} numberOfLines={1}>
          {vehicle.displayName}{plateDisplay}
        </Text>
      </View>

      <Text style={[disc.heading, { color: c.foreground }]}>Before you join</Text>

      <View style={disc.section}>
        <Text style={[disc.sectionTitle, { color: "#22C55E" }]}>✓ Shared with co-drivers</Text>
        {[
          "Total distance driven by this car",
          "Combined drive session count",
          "Service interval tracking",
        ].map(t => (
          <Text key={t} style={[disc.item, { color: c.mutedForeground }]}>• {t}</Text>
        ))}
      </View>

      <View style={disc.section}>
        <Text style={[disc.sectionTitle, { color: c.mutedForeground }]}>🔒 Always private — only you see</Text>
        {[
          "Where you drove — all trip routes",
          "Your speed & driving behaviour",
          "Your fines, crash reports & personal info",
        ].map(t => (
          <Text key={t} style={[disc.item, { color: c.mutedForeground }]}>• {t}</Text>
        ))}
      </View>

      <View style={disc.actions}>
        <TouchableOpacity
          style={[disc.cancelBtn, { borderColor: c.border }]}
          onPress={onCancel}
          activeOpacity={0.8}
        >
          <Text style={[disc.cancelTxt, { color: c.mutedForeground }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[disc.confirmBtn, { backgroundColor: c.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={onConfirm}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={disc.confirmTxt}>{confirmLabel ?? "Confirm"}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const disc = StyleSheet.create({
  container:    { borderRadius: 20, borderWidth: 1, padding: 20, gap: 14 },
  vehicleRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12 },
  vehicleName:  { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" },
  heading:      { fontSize: 16, fontFamily: "Inter_700Bold" },
  section:      { gap: 4 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  item:         { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  actions:      { flexDirection: "row", gap: 12, marginTop: 4 },
  cancelBtn:    { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: "center" },
  cancelTxt:    { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  confirmBtn:   { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center", justifyContent: "center", minHeight: 48 },
  confirmTxt:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

// ── Main screen ────────────────────────────────────────────────────────────────

export default function JoinVehicleScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const { deviceId, driverName } = useApp();
  const { prefillPlate } = useLocalSearchParams<{ prefillPlate?: string }>();

  const [activeTab, setActiveTab] = useState<Tab>(prefillPlate ? "plate" : "code");

  // ── Code tab state ───────────────────────────────────────────────────────────
  const [codeInput,   setCodeInput]   = useState("");
  const [codeVehicle, setCodeVehicle] = useState<FoundVehicle | null>(null);
  const [codeJoining, setCodeJoining] = useState(false);

  // ── Pre-fill plate from navigation param (from vehicle-setup duplicate flow) ─
  useEffect(() => {
    if (prefillPlate) {
      setPlateInput(prefillPlate);
    }
  }, [prefillPlate]);

  // ── Plate tab state ──────────────────────────────────────────────────────────
  const [plateInput,         setPlateInput]         = useState("");
  const [plateSearching,     setPlateSearching]     = useState(false);
  const [plateFound,         setPlateFound]         = useState<FoundVehicle | null>(null);
  const [plateAlreadyMember, setPlateAlreadyMember] = useState(false);
  const [platePending,       setPlatePending]       = useState(false);
  const [plateRequesting,    setPlateRequesting]    = useState(false);
  const [plateRequested,     setPlateRequested]     = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Strip "MSF-" prefix and any non-alphanumeric chars, uppercase */
  function extractCode(input: string): string {
    return input.replace(/^MSF[-\s]?/i, "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }

  function formatPlateInput(raw: string): string {
    const clean = raw.replace(/[^A-Z0-9a-z]/g, "").toUpperCase().slice(0, 7);
    if (clean.length > 3 && /^[A-Z]{3}/.test(clean)) {
      return clean.slice(0, 3) + " " + clean.slice(3);
    }
    return clean;
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setCodeVehicle(null);
    setPlateFound(null);
    setPlateRequested(false);
    setPlateAlreadyMember(false);
    setPlatePending(false);
  }

  // ── Code tab: show disclosure ─────────────────────────────────────────────────

  function handleShowCodeDisclosure() {
    const raw = extractCode(codeInput);
    if (raw.length < 4) {
      Alert.alert("Invalid code", "Enter the full share code (e.g. MSF-AB3C2).");
      return;
    }
    // Show privacy disclosure; the real vehicle name is revealed after joining
    setCodeVehicle({ id: raw, plateNumber: null, displayName: "this vehicle", vehicleType: "car" });
  }

  // ── Code tab: join after disclosure confirm ───────────────────────────────────

  async function handleJoinByCode() {
    if (!deviceId) return;
    const raw = extractCode(codeInput);
    setCodeJoining(true);
    try {
      const result = await apiPost<{
        success?: boolean;
        alreadyOwner?: boolean;
        vehicle?: FoundVehicle & { memberToken?: string };
        error?: string;
      }>("/vehicles/join-by-code", {
        deviceId,
        shareCode:     raw,
        requesterName: driverName || undefined,
      });

      if (result.alreadyOwner) {
        Alert.alert("That's your vehicle!", "You're already the owner of this car.");
        setCodeVehicle(null);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const v    = result.vehicle;
      const name = v?.displayName ?? "the vehicle";
      const plate = v?.plateNumber ? ` (${v.plateNumber})` : "";

      // Persist a local vehicle entry so the co-driver sees it in their garage
      if (v?.id) {
        await addSharedVehicle({
          sharedVehicleId: v.id,
          displayName:     v.displayName,
          vehicleType:     v.vehicleType ?? "car",
          plateNumber:     v.plateNumber ?? undefined,
          memberToken:     (result as any).memberToken ?? v?.memberToken ?? undefined,
        });
      }

      Alert.alert(
        "Joined! 🎉",
        `You're now a co-driver of ${name}${plate}. It's in your Garage — stats will be combined going forward.`,
        [{ text: "Done", onPress: () => router.back() }],
      );
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (msg.includes("Invalid share code") || msg.includes("404")) {
        Alert.alert("Invalid code", "That code doesn't match any vehicle. Check it and try again.");
      } else {
        Alert.alert("Couldn't join", msg || "Check your connection and try again.");
      }
      setCodeVehicle(null);
    } finally {
      setCodeJoining(false);
    }
  }

  // ── Plate tab: search ─────────────────────────────────────────────────────────

  async function handleSearchPlate() {
    const canonical = normalizePlate(plateInput);
    if (!canonical || canonical.length < 5) {
      Alert.alert("Enter a plate", "Type the full number plate (e.g. KDA 123A).");
      return;
    }
    setPlateSearching(true);
    setPlateFound(null);
    setPlateAlreadyMember(false);
    setPlatePending(false);
    setPlateRequested(false);
    try {
      const result = await apiGet<{
        found: boolean;
        vehicle?: FoundVehicle;
        alreadyMember?: boolean;
        hasPendingRequest?: boolean;
      }>(`/vehicles/search?plate=${encodeURIComponent(canonical)}&deviceId=${deviceId ?? ""}`);

      if (!result.found || !result.vehicle) {
        Alert.alert(
          "Not found",
          `${canonical} isn't registered on Msafiri yet.\n\nAsk the owner to open their Garage, tap Share on their vehicle, and send you the code instead.`,
        );
        return;
      }
      setPlateFound(result.vehicle);
      setPlateAlreadyMember(result.alreadyMember ?? false);
      setPlatePending(result.hasPendingRequest ?? false);
    } catch {
      Alert.alert("Search failed", "Check your connection and try again.");
    } finally {
      setPlateSearching(false);
    }
  }

  // ── Plate tab: request to join ────────────────────────────────────────────────

  async function handleRequestJoin() {
    if (!deviceId || !plateFound) return;
    setPlateRequesting(true);
    try {
      await apiPost("/vehicles/join-request", {
        deviceId,
        vehicleId:     plateFound.id,
        requesterName: driverName || undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPlateRequested(true);
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (err?.status === 429) {
        Alert.alert("Too many requests", "You've sent too many join requests. Please wait 10 minutes before trying again.");
      } else if (msg.includes("Already a co-driver")) {
        Alert.alert("Already joined", "You're already a co-driver of this vehicle.");
        setPlateAlreadyMember(true);
      } else if (msg.includes("pending request")) {
        Alert.alert("Request pending", "You've already sent a request. The owner will respond soon.");
        setPlatePending(true);
      } else {
        Alert.alert("Request failed", msg || "Check your connection and try again.");
      }
    } finally {
      setPlateRequesting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const cardBg = c.card;

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Join a Shared Vehicle</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={[styles.tabRow, { backgroundColor: c.muted, margin: 16, marginBottom: 0 }]}>
        {([ ["code", "Enter Code"], ["plate", "Search by Plate"] ] as const).map(([tab, label]) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && {
                backgroundColor: cardBg,
                shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
              },
            ]}
            onPress={() => switchTab(tab)}
            activeOpacity={0.85}
          >
            <Text style={[styles.tabTxt, { color: activeTab === tab ? c.foreground : c.mutedForeground }]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── Code tab: input ── */}
          {activeTab === "code" && !codeVehicle && (
            <View style={styles.section}>
              <Text style={[styles.hint, { color: c.mutedForeground }]}>
                Ask the vehicle owner to open their Garage, tap Share on their vehicle, and send you the code.
              </Text>
              <View style={[styles.inputRow, { backgroundColor: cardBg, borderColor: c.border }]}>
                <Ionicons name="key-outline" size={18} color={c.mutedForeground} style={{ marginLeft: 14 }} />
                <TextInput
                  style={[styles.input, { color: c.foreground }]}
                  value={codeInput}
                  onChangeText={t => setCodeInput(t.replace(/[^A-Z0-9a-z\-]/g, "").toUpperCase().slice(0, 9))}
                  placeholder="MSF-AB3C2"
                  placeholderTextColor={c.mutedForeground}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={9}
                  returnKeyType="done"
                  onSubmitEditing={handleShowCodeDisclosure}
                />
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: extractCode(codeInput).length < 4 ? 0.5 : 1 }]}
                onPress={handleShowCodeDisclosure}
                disabled={extractCode(codeInput).length < 4}
                activeOpacity={0.85}
              >
                <Ionicons name="arrow-forward-circle-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnTxt}>Continue</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Code tab: privacy disclosure ── */}
          {activeTab === "code" && codeVehicle && (
            <PrivacyDisclosure
              vehicle={codeVehicle}
              loading={codeJoining}
              confirmLabel="Join Vehicle"
              onConfirm={handleJoinByCode}
              onCancel={() => setCodeVehicle(null)}
            />
          )}

          {/* ── Plate tab: input ── */}
          {activeTab === "plate" && !plateFound && (
            <View style={styles.section}>
              <Text style={[styles.hint, { color: c.mutedForeground }]}>
                Enter the car's number plate. If the owner has registered it on Msafiri, you can request to join.
              </Text>
              <View style={[styles.inputRow, { backgroundColor: cardBg, borderColor: c.border }]}>
                <Ionicons name="card-outline" size={18} color={c.mutedForeground} style={{ marginLeft: 14 }} />
                <TextInput
                  style={[styles.input, { color: c.foreground }]}
                  value={plateInput}
                  onChangeText={t => setPlateInput(formatPlateInput(t))}
                  placeholder="KDA 123A"
                  placeholderTextColor={c.mutedForeground}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                  returnKeyType="search"
                  onSubmitEditing={handleSearchPlate}
                />
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: plateInput.length < 5 ? 0.5 : 1 }]}
                onPress={handleSearchPlate}
                disabled={plateInput.length < 5 || plateSearching}
                activeOpacity={0.85}
              >
                {plateSearching
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Ionicons name="search-outline" size={18} color="#fff" />
                      <Text style={styles.primaryBtnTxt}>Search</Text>
                    </>}
              </TouchableOpacity>
            </View>
          )}

          {/* ── Plate tab: vehicle found ── */}
          {activeTab === "plate" && plateFound && !plateRequested && (
            <View style={styles.section}>
              {plateAlreadyMember ? (
                <View style={[styles.statusCard, { backgroundColor: "#22C55E18", borderColor: "#22C55E40" }]}>
                  <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
                  <Text style={[styles.statusTxt, { color: "#22C55E" }]}>You're already a co-driver of this vehicle.</Text>
                </View>
              ) : platePending ? (
                <View style={[styles.statusCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Ionicons name="time-outline" size={22} color={c.mutedForeground} />
                  <Text style={[styles.statusTxt, { color: c.mutedForeground }]}>Request pending — the owner will respond soon.</Text>
                </View>
              ) : (
                <PrivacyDisclosure
                  vehicle={plateFound}
                  loading={plateRequesting}
                  confirmLabel="Send Request"
                  onConfirm={handleRequestJoin}
                  onCancel={() => setPlateFound(null)}
                />
              )}
              {(plateAlreadyMember || platePending) && (
                <TouchableOpacity onPress={() => setPlateFound(null)} style={styles.secondaryBtn}>
                  <Text style={[styles.secondaryBtnTxt, { color: c.mutedForeground }]}>Search a different plate</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Plate tab: request sent ── */}
          {activeTab === "plate" && plateRequested && (
            <View style={[styles.successCard, { backgroundColor: "#22C55E12", borderColor: "#22C55E40" }]}>
              <Ionicons name="checkmark-circle" size={40} color="#22C55E" />
              <Text style={[styles.successTitle, { color: c.foreground }]}>Request Sent!</Text>
              <Text style={[styles.successSub, { color: c.mutedForeground }]}>
                The owner has been notified. You'll get a push notification when they approve or decline.
              </Text>
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: c.primary, alignSelf: "stretch" }]} onPress={() => router.back()}>
                <Text style={styles.primaryBtnTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },

  tabRow: { flexDirection: "row", borderRadius: 14, padding: 4 },
  tab:    { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: "center" },
  tabTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  content: { padding: 16, gap: 16 },
  section: { gap: 14 },
  hint:    { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1, overflow: "hidden",
  },
  input: {
    flex: 1, paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 16, fontFamily: "Inter_500Medium",
  },

  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 14,
  },
  primaryBtnTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },

  secondaryBtn:    { alignItems: "center", paddingVertical: 10 },
  secondaryBtnTxt: { fontSize: 14, fontFamily: "Inter_500Medium" },

  statusCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 16, borderWidth: 1,
  },
  statusTxt: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },

  successCard: {
    alignItems: "center", gap: 12, padding: 28, borderRadius: 20, borderWidth: 1,
  },
  successTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  successSub:   { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
});
