export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost, apiDelete } from "@/utils/apiClient";

interface EmergencyContact { id: string; name: string; phone: string }

export default function EmergencyContactsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { deviceId, driverName } = useApp();

  const [ecContacts, setEcContacts] = useState<EmergencyContact[]>([]);
  const [ecLoading, setEcLoading] = useState(false);
  const [ecName, setEcName] = useState("");
  const [ecPhone, setEcPhone] = useState("");
  const [ecSaving, setEcSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  const loadEmergencyContacts = useCallback(async () => {
    if (!deviceId) return;
    setEcLoading(true);
    try {
      const res = await apiGet<{ contacts: EmergencyContact[] }>(`/emergency-contacts?deviceId=${deviceId}`);
      if (res?.contacts) {
        setEcContacts(res.contacts);
      }
    } catch { /* ignore */ } finally { setEcLoading(false); }
  }, [deviceId]);

  useEffect(() => { loadEmergencyContacts(); }, [loadEmergencyContacts]);

  const addEmergencyContact = async () => {
    if (!ecName.trim() || !ecPhone.trim()) {
      Alert.alert("Incomplete", "Enter both a name and phone number.");
      return;
    }
    if (!deviceId) return;
    setEcSaving(true);
    try {
      const res = await apiPost<EmergencyContact>("/emergency-contacts", { deviceId, name: ecName.trim(), phone: ecPhone.trim() });
      setEcContacts((prev) => [...prev, res]);
      setEcName(""); setEcPhone("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save contact. Check the number format (+254…).";
      Alert.alert("Error", msg);
    } finally { setEcSaving(false); }
  };

  const removeEmergencyContact = (id: string) => {
    Alert.alert("Remove Contact", "Remove this emergency contact?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          try {
            await apiDelete(`/emergency-contacts/${id}?deviceId=${deviceId}`, {});
            setEcContacts((prev) => prev.filter((c) => c.id !== id));
          } catch { Alert.alert("Error", "Could not remove contact."); }
        },
      },
    ]);
  };

  const sendTestAlert = async () => {
    if (!deviceId) return;
    setSendingTest(true);
    try {
      const res = await apiPost<{ sent: number; total: number }>("/emergency/alert", {
        deviceId, lat: 0, lng: 0, driverName, isTest: true,
      });
      Alert.alert("Test Sent", res.sent > 0
        ? `Test message sent to ${res.sent} contact${res.sent !== 1 ? "s" : ""}.`
        : "No contacts saved — add at least one contact first.");
    } catch { Alert.alert("Error", "Could not send test alert. Check your connection."); }
    finally { setSendingTest(false); }
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Emergency Contacts</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
          These contacts are called automatically if a crash is detected
        </Text>

        <View style={[styles.cardGroup, { backgroundColor: c.card }]}>
          {ecContacts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="shield-outline" size={32} color={c.mutedForeground} style={{ marginBottom: 12 }} />
              <Text style={[styles.emptyStateText, { color: c.mutedForeground }]}>
                No emergency contacts added yet. Add one below.
              </Text>
            </View>
          ) : (
            ecContacts.map((contact, idx) => (
              <View key={contact.id}>
                <View style={styles.contactRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                    <Ionicons name="person-circle" size={36} color={c.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.contactName, { color: c.foreground }]}>{contact.name}</Text>
                      <Text style={[styles.contactPhone, { color: c.mutedForeground }]}>{contact.phone}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeEmergencyContact(contact.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.deleteBtn}
                  >
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
                {idx < ecContacts.length - 1 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
              </View>
            ))
          )}
        </View>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground, paddingHorizontal: 4, marginTop: 24 }]}>
          Add Contact
        </Text>
        
        {ecContacts.length >= 5 ? (
          <View style={[styles.limitCard, { backgroundColor: c.muted }]}>
            <Text style={[styles.limitText, { color: c.mutedForeground }]}>Maximum 5 contacts reached</Text>
          </View>
        ) : (
          <View style={[styles.addCard, { backgroundColor: c.card }]}>
            <View style={styles.inputGroup}>
              <TextInput
                style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
                placeholder="Contact name"
                placeholderTextColor={c.mutedForeground}
                value={ecName}
                onChangeText={setEcName}
                returnKeyType="next"
              />
            </View>
            <View style={styles.inputGroup}>
              <TextInput
                style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
                placeholder="+254 7XX XXX XXX"
                placeholderTextColor={c.mutedForeground}
                value={ecPhone}
                onChangeText={setEcPhone}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: c.primary, opacity: ecSaving ? 0.6 : 1 }]}
              onPress={addEmergencyContact}
              disabled={ecSaving}
              activeOpacity={0.8}
            >
              <Ionicons name={ecSaving ? "hourglass-outline" : "add"} size={20} color={c.primaryForeground} />
              <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>
                {ecSaving ? "Saving…" : "Save Contact"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.testBtn, { borderColor: c.primary }]}
          onPress={sendTestAlert}
          disabled={sendingTest || ecContacts.length === 0}
          activeOpacity={0.7}
        >
          <Ionicons name={sendingTest ? "hourglass-outline" : "send-outline"} size={20} color={c.primary} />
          <Text style={[styles.testBtnText, { color: c.primary }]}>
            {sendingTest ? "Sending…" : "Send Test Message"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 12, marginBottom: 20 },
  
  cardGroup: { borderRadius: 16, overflow: "hidden" },
  emptyState: { padding: 32, alignItems: "center", justifyContent: "center" },
  emptyStateText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  contactName: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  contactPhone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  deleteBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#EF444415" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
  
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8, textTransform: "uppercase" },
  addCard: { borderRadius: 16, padding: 16, gap: 12 },
  inputGroup: { marginBottom: 4 },
  input: { borderRadius: 10, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14 },
  
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 14, borderRadius: 12, marginTop: 4, gap: 8 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  
  limitCard: { borderRadius: 16, padding: 16, alignItems: "center", justifyContent: "center" },
  limitText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", padding: 16, borderRadius: 12, borderWidth: 1, marginTop: 24, gap: 8 },
  testBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
