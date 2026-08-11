import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiDelete } from "@/utils/apiClient";

interface Member {
  id: string;
  role: "owner" | "driver";
  memberName: string | null;
  isCurrentDevice: boolean;
  joinedAt: string;
}

export default function VehicleShareCodeScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const { shareCode, vehicleName, plateNumber, vehicleId, deviceId, memberToken } =
    useLocalSearchParams<{
      shareCode:    string;
      vehicleName:  string;
      plateNumber?: string;
      vehicleId?:   string;
      deviceId?:    string;
      memberToken?: string;
    }>();

  const [copied,     setCopied]     = useState(false);
  const [members,    setMembers]    = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  /** Display code with "MSF-" prefix: MSF-AB3C2 */
  const displayCode  = shareCode ? `MSF-${shareCode}` : "—";
  const plateDisplay = plateNumber ? ` (${plateNumber})` : "";

  // ── Fetch member list ───────────────────────────────────────────────────────
  const fetchMembers = useCallback(async () => {
    if (!vehicleId || !deviceId) return;
    setLoadingMembers(true);
    try {
      const res = await apiGet<{ members: Member[] }>(
        `/vehicles/${vehicleId}/members?deviceId=${deviceId}`,
      );
      setMembers(res.members ?? []);
    } catch {
      // Non-fatal — member list is supplementary info
    } finally {
      setLoadingMembers(false);
    }
  }, [vehicleId, deviceId]);

  useFocusEffect(useCallback(() => { fetchMembers(); }, [fetchMembers]));

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!shareCode) return;
    await Clipboard.setStringAsync(displayCode);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2500);
  }, [shareCode, displayCode]);

  const handleShare = useCallback(async () => {
    if (!shareCode) return;
    try {
      await Share.share({
        message: `Join my ${vehicleName}${plateDisplay} on Msafiri Kenya!\n\nUse code: ${displayCode}\n\nOpen Msafiri → Garage → Join a Shared Vehicle → enter this code.`,
        title: "Join my car on Msafiri",
      });
    } catch { /* user cancelled */ }
  }, [shareCode, vehicleName, plateDisplay, displayCode]);

  const handleRemoveMember = useCallback((member: Member) => {
    if (!vehicleId || !deviceId) return;
    const name = member.memberName || "this co-driver";
    Alert.alert(
      "Remove Co-driver",
      `Remove ${name} from ${vehicleName}? They'll no longer share stats for this vehicle.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // Derive their deviceId from member.id isn't possible — we need the
            // member's deviceId. The GET endpoint returns memberDeviceId masked
            // for privacy; we use the member's row id to identify them and pass
            // deviceId (ours) to authenticate. The API uses the URL param
            // (:memberDeviceId) but since we only have the member row id, we
            // need a different approach.
            //
            // DESIGN: the DELETE endpoint takes :memberDeviceId in the URL.
            // Since we don't expose raw device IDs in the member list (privacy),
            // we add a memberRowId path and let the API look up the row.
            // For now we pass the member row id as the "memberDeviceId" param
            // and add an id-based lookup to the API.
            setRemovingId(member.id);
            try {
              await apiDelete(
                `/vehicles/${vehicleId}/members-by-row/${member.id}`,
                { deviceId },
                10000,
                memberToken ? { Authorization: `Bearer ${memberToken}` } : undefined,
              );
              setMembers(prev => prev.filter(m => m.id !== member.id));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err: any) {
              Alert.alert("Error", err?.message || "Could not remove member. Try again.");
            } finally {
              setRemovingId(null);
            }
          },
        },
      ],
    );
  }, [vehicleId, deviceId, vehicleName]);

  // ── Computed ────────────────────────────────────────────────────────────────
  const drivers = members.filter(m => m.role === "driver");

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Share Vehicle</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Vehicle chip */}
        <View style={[styles.vehicleChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "30" }]}>
          <Ionicons name="car-outline" size={16} color={c.primary} />
          <Text style={[styles.vehicleChipTxt, { color: c.primary }]} numberOfLines={1}>
            {vehicleName}{plateDisplay}
          </Text>
        </View>

        {/* Purpose description */}
        <Text style={[styles.purpose, { color: c.mutedForeground }]}>
          Add other drivers who use this vehicle. Their trips will automatically update the
          vehicle's mileage and help keep service reminders accurate.
        </Text>

        {/* Code card */}
        <View style={[styles.codeCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.codeLabel, { color: c.mutedForeground }]}>Share Code</Text>
          <Text style={[styles.codeText, { color: c.foreground }]}>{displayCode}</Text>
          <Text style={[styles.codeSub, { color: c.mutedForeground }]}>
            Valid until you regenerate it
          </Text>
        </View>

        {/* Action buttons */}
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: copied ? "#22C55E" : c.primary }]}
          onPress={handleCopy}
          activeOpacity={0.85}
        >
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color="#fff" />
          <Text style={styles.btnTxt}>{copied ? "Copied!" : "Copy Code"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnOutline, { borderColor: c.border, backgroundColor: c.card }]}
          onPress={handleShare}
          activeOpacity={0.85}
        >
          <Ionicons name="share-social-outline" size={18} color={c.foreground} />
          <Text style={[styles.btnOutlineTxt, { color: c.foreground }]}>Share via WhatsApp / SMS</Text>
        </TouchableOpacity>

        {/* ── Co-drivers list ── */}
        <View style={[styles.membersCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.membersHeader}>
            <Text style={[styles.membersTitle, { color: c.foreground }]}>Co-drivers</Text>
            {loadingMembers && <ActivityIndicator size="small" color={c.primary} />}
          </View>

          {!loadingMembers && drivers.length === 0 && (
            <View style={styles.emptyMembers}>
              <Ionicons name="people-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                No co-drivers yet. Share your code to invite family members.
              </Text>
            </View>
          )}

          {drivers.map((member, i) => {
            const name = member.memberName || "Co-driver";
            const joined = new Date(member.joinedAt).toLocaleDateString("en-KE", {
              month: "short", day: "numeric",
            });
            const isRemoving = removingId === member.id;

            return (
              <View
                key={member.id}
                style={[
                  styles.memberRow,
                  { borderTopColor: c.border },
                  i === 0 && { borderTopWidth: 0 },
                ]}
              >
                {/* Avatar */}
                <View style={[styles.memberAvatar, { backgroundColor: c.primary + "20" }]}>
                  <Text style={[styles.memberAvatarTxt, { color: c.primary }]}>
                    {name.charAt(0).toUpperCase()}
                  </Text>
                </View>

                {/* Info */}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: c.foreground }]}>
                    {name}
                  </Text>
                  <Text style={[styles.memberJoined, { color: c.mutedForeground }]}>
                    Joined {joined}
                  </Text>
                </View>

                {/* Remove button */}
                <TouchableOpacity
                  style={[styles.removeBtn, { borderColor: "#EF444435", backgroundColor: "#EF444410" }]}
                  onPress={() => handleRemoveMember(member)}
                  disabled={isRemoving}
                  activeOpacity={0.8}
                >
                  {isRemoving
                    ? <ActivityIndicator size="small" color="#EF4444" />
                    : <Ionicons name="person-remove-outline" size={14} color="#EF4444" />}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        {/* Privacy summary */}
        <View style={[styles.privacyCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.privacyTitle, { color: c.foreground }]}>What co-drivers can see</Text>

          <View style={styles.privacySection}>
            <Text style={[styles.privacySectionTitle, { color: "#22C55E" }]}>✓ Shared</Text>
            {["Total distance driven by this car", "Combined drive session count", "Vehicle odometer & service intervals"].map(item => (
              <Text key={item} style={[styles.privacyItem, { color: c.mutedForeground }]}>• {item}</Text>
            ))}
          </View>

          <View style={styles.privacySection}>
            <Text style={[styles.privacySectionTitle, { color: c.mutedForeground }]}>🔒 Always private</Text>
            {["Your trip routes (where you drove)", "Your speed & driving behaviour", "Your fine records", "Your crash reports", "Your personal information"].map(item => (
              <Text key={item} style={[styles.privacyItem, { color: c.mutedForeground }]}>• {item}</Text>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: 16,
    paddingVertical:   14,
    borderBottomWidth: 1,
  },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },

  body: {
    paddingHorizontal: 20,
    paddingTop:        24,
    gap:               16,
  },

  vehicleChip: {
    flexDirection:     "row",
    alignItems:        "center",
    alignSelf:         "center",
    gap:               8,
    paddingVertical:   8,
    paddingHorizontal: 16,
    borderRadius:      20,
    borderWidth:       1,
  },
  vehicleChipTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", maxWidth: 260 },

  purpose: {
    fontSize:    14,
    fontFamily:  "Inter_400Regular",
    lineHeight:  21,
    textAlign:   "center",
    paddingHorizontal: 8,
  },

  codeCard: {
    alignItems:        "center",
    paddingVertical:   28,
    paddingHorizontal: 24,
    borderRadius:      20,
    borderWidth:       1,
    gap:               6,
  },
  codeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  codeText: {
    fontSize:      38,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 4,
  },
  codeSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  btn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 16,
    borderRadius:    16,
  },
  btnTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },

  btnOutline: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 16,
    borderRadius:    16,
    borderWidth:     1,
  },
  btnOutlineTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  // ── Members section ─────────────────────────────────────────────────────────
  membersCard: {
    borderRadius: 16,
    borderWidth:  1,
    padding:      16,
    gap:          0,
  },
  membersHeader: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginBottom:   12,
  },
  membersTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },

  emptyMembers: {
    alignItems: "center",
    gap:        8,
    paddingVertical: 16,
  },
  emptyTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  memberRow: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            12,
    paddingVertical: 10,
    borderTopWidth:  1,
  },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  memberAvatarTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  memberName:   { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  memberJoined: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  removeBtn: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },

  // ── Privacy card ────────────────────────────────────────────────────────────
  privacyCard: {
    borderRadius: 16,
    borderWidth:  1,
    padding:      16,
    gap:          12,
  },
  privacyTitle:        { fontSize: 14, fontFamily: "Inter_700Bold" },
  privacySection:      { gap: 4 },
  privacySectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  privacyItem:         { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
