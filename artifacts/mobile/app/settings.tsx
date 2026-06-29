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
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

export default function SettingsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { hudMode, setHudMode, sosContact, setSosContact, clearTripHistory } = useApp();

  const [name, setName] = useState(sosContact?.name ?? "");
  const [phone, setPhone] = useState(sosContact?.phone ?? "");
  const [saved, setSaved] = useState(false);

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

  const Row = ({
    label,
    value,
    icon,
    onPress,
    danger,
  }: {
    label: string;
    value?: string;
    icon: string;
    onPress: () => void;
    danger?: boolean;
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
      contentContainerStyle={{ paddingBottom: bottomInset + 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Close button */}
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
        <Ionicons name="close" size={22} color={c.foreground} />
      </TouchableOpacity>

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
  closeBtn: {
    alignSelf: "flex-end",
    padding: 16,
    paddingTop: 20,
  },
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
});
