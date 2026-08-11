export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { getLinkedPhone } from "@/utils/backupSync";
import { useColors } from "@/hooks/useColors";
import { getVehicleTypeDef, VEHICLE_TYPES } from "@/data/vehicleTypes";
import type { VehicleTypeId } from "@/data/vehicleTypes";

// Emoji per vehicle type (mirrors vehicle-setup.tsx)
function typeEmoji(id: string): string {
  return id === "motorcycle" ? "🏍️" : id === "bus" ? "🚌" : id === "psv" ? "🚐" :
         id === "truck" ? "🚛" : id === "tractor" ? "🚜" : "🚗";
}

export default function PersonalInformationScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { driverName, setDriverName, vehicleType, setVehicleType, setProfilePhotoUri } = useApp();

  const [name, setName] = useState(driverName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("profile_email").then(val => { if (val) setEmail(val); });
    AsyncStorage.getItem("profile_phone").then(val => { if (val) setPhone(val); });
    AsyncStorage.getItem("profile_photo_uri").then(val => { if (val) setPhotoUri(val); });
  }, []);

  // Re-check linked phone whenever this screen gains focus (e.g. returning from /link-phone)
  useFocusEffect(useCallback(() => {
    getLinkedPhone().then(linked => setLinkedPhone(linked)).catch(() => {});
  }, []));

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Photo Library Access Required",
          "Msafiri needs photo library access to set your profile photo and to attach evidence photos in the Crash Assistant.\n\nTo enable: Settings → Privacy & Security → Photos → Msafiri → select \"All Photos\" or \"Selected Photos\".",
          [{ text: "OK" }]
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const pickedUri = result.assets[0].uri;

      let storedUri = pickedUri;
      if (Platform.OS !== "web") {
        // Picker URIs live in a cache dir the OS may purge — copy into the
        // app's document directory so the photo survives restarts.
        const FileSystem = await import("expo-file-system/legacy");
        if (FileSystem.documentDirectory) {
          const dest = `${FileSystem.documentDirectory}profile_photo_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: pickedUri, to: dest });
          const old = await AsyncStorage.getItem("profile_photo_uri");
          if (old && old.startsWith(FileSystem.documentDirectory)) {
            FileSystem.deleteAsync(old, { idempotent: true }).catch(() => {});
          }
          storedUri = dest;
        }
      }
      await AsyncStorage.setItem("profile_photo_uri", storedUri);
      setPhotoUri(storedUri);
      setProfilePhotoUri(storedUri);
    } catch (e) {
      console.warn("Change photo error:", e);
      Alert.alert("Error", "Could not update your photo. Please try again.");
    }
  };

  const removePhoto = async () => {
    try {
      if (Platform.OS !== "web" && photoUri) {
        const FileSystem = await import("expo-file-system/legacy");
        if (FileSystem.documentDirectory && photoUri.startsWith(FileSystem.documentDirectory)) {
          FileSystem.deleteAsync(photoUri, { idempotent: true }).catch(() => {});
        }
      }
      await AsyncStorage.removeItem("profile_photo_uri");
      setPhotoUri(null);
      setProfilePhotoUri(null);
    } catch (e) {
      console.warn("Remove photo error:", e);
    }
  };

  const handleChangePhoto = () => {
    if (photoUri) {
      Alert.alert("Profile Photo", "What would you like to do?", [
        { text: "Change Photo", onPress: pickPhoto },
        { text: "Remove Photo", style: "destructive", onPress: removePhoto },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      pickPhoto();
    }
  };

  const vehicleLabel = getVehicleTypeDef(vehicleType).label;
  const initials = name ? name.substring(0, 2).toUpperCase() : "DR";

  /** Strip anything that isn't a plain letter, then capitalise the first letter */
  const normalizeName = (raw: string) => {
    const letters = raw.replace(/[^a-zA-Z]/g, "");
    return letters.length === 0 ? "" : letters[0].toUpperCase() + letters.slice(1).toLowerCase();
  };

  const handleSave = async () => {
    const normalized = normalizeName(name);
    setDriverName(normalized);
    setName(normalized);
    await AsyncStorage.setItem("profile_email", email);
    await AsyncStorage.setItem("profile_phone", phone);
    Alert.alert("Saved!", "Your personal information has been updated.");
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Personal Information</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handleChangePhoto} activeOpacity={0.75}>
            <View style={[styles.avatarCircle, { backgroundColor: c.primary + "1E" }]}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImage} />
              ) : (
                <Text style={[styles.avatarInitials, { color: c.primary }]}>{initials}</Text>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleChangePhoto} activeOpacity={0.7}>
            <Text style={[styles.changePhotoText, { color: c.primary }]}>Change Photo</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.formCard, { backgroundColor: c.card }]}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>First Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
              value={name}
              onChangeText={(t) => setName(t.replace(/[^a-zA-Z]/g, ""))}
              placeholder="Your first name"
              placeholderTextColor={c.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={30}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Email Address</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
              value={email}
              onChangeText={setEmail}
              placeholder="e.g. peter@email.com"
              placeholderTextColor={c.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Contact Phone</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
              value={phone}
              onChangeText={setPhone}
              placeholder="+254 7XX XXX XXX"
              placeholderTextColor={c.mutedForeground}
              keyboardType="phone-pad"
            />
          </View>

          {/* Recovery phone — OTP-verified, read-only */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Recovery Phone</Text>
            {linkedPhone ? (
              <TouchableOpacity
                style={[styles.input, styles.readOnlyRow, { backgroundColor: c.muted }]}
                onPress={() => router.push("/link-phone" as any)}
                activeOpacity={0.75}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                  <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                  <Text style={{ color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
                    {linkedPhone.replace(/(\+254)(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4")}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.primary }}>Change</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.input, { backgroundColor: c.primary + "10", borderWidth: 1,
                  borderColor: c.primary + "40", borderRadius: 10, flexDirection: "row",
                  alignItems: "center", gap: 8 }]}
                onPress={() => router.push("/link-phone" as any)}
                activeOpacity={0.8}
              >
                <Ionicons name="phone-portrait-outline" size={16} color={c.primary} />
                <Text style={{ color: c.primary, fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 }}>
                  Link recovery phone
                </Text>
                <Ionicons name="chevron-forward" size={14} color={c.primary} />
              </TouchableOpacity>
            )}
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: c.mutedForeground, marginTop: 4, lineHeight: 15 }}>
              Used to restore your data via SMS if you lose your phone.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Vehicle Type</Text>
            <TouchableOpacity 
              style={[styles.input, styles.readOnlyRow, { backgroundColor: c.muted }]}
              onPress={() => setShowVehiclePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={{ color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}>{vehicleLabel}</Text>
              <Ionicons name="chevron-expand" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.verifiedCard, { backgroundColor: c.card, borderColor: c.primary }]}>
          <Ionicons name="shield-checkmark" size={24} color={c.primary} />
          <Text style={[styles.verifiedText, { color: c.foreground }]}>Your account is verified</Text>
        </View>

        <TouchableOpacity style={[styles.saveBtn, { backgroundColor: c.primary }]} onPress={handleSave} activeOpacity={0.8}>
          <Text style={[styles.saveBtnText, { color: c.primaryForeground }]}>Save Changes</Text>
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>

      {/* ── Vehicle type bottom-sheet picker ─────────────────────────────── */}
      <Modal
        visible={showVehiclePicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowVehiclePicker(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}
          onPress={() => setShowVehiclePicker(false)}
        >
          {/* Stop tap propagation so tapping inside the sheet doesn't close it */}
          <Pressable onPress={() => {}}>
            <View style={[styles.vehicleSheet, { backgroundColor: c.card }]}>
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: c.foreground }]}>Select Vehicle Type</Text>
              <View style={styles.vehicleGrid}>
                {VEHICLE_TYPES.map((vt) => {
                  const active = vehicleType === vt.id;
                  return (
                    <TouchableOpacity
                      key={vt.id}
                      style={[
                        styles.vehicleGridItem,
                        {
                          backgroundColor: active ? c.primary + "22" : c.muted,
                          borderColor: active ? c.primary : "transparent",
                        },
                      ]}
                      onPress={() => {
                        setVehicleType(vt.id as VehicleTypeId);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowVehiclePicker(false);
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.vehicleGridEmoji}>{typeEmoji(vt.id)}</Text>
                      <Text style={[styles.vehicleGridLabel, { color: active ? c.primary : c.foreground }]}>
                        {vt.shortLabel ?? vt.label}
                      </Text>
                      {active && (
                        <Ionicons name="checkmark-circle" size={16} color={c.primary} style={styles.vehicleGridCheck} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  
  avatarSection: { alignItems: "center", marginTop: 24, marginBottom: 24 },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden" },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarInitials: { fontSize: 32, fontFamily: "Inter_700Bold" },
  changePhotoText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  
  formCard: { borderRadius: 16, padding: 16, gap: 12 },
  inputGroup: { marginBottom: 4 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: { borderRadius: 10, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14 },
  readOnlyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  
  verifiedCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 16, borderWidth: 1, marginTop: 16, marginBottom: 24 },
  verifiedText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  
  saveBtn: { padding: 16, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: "auto" },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  // Vehicle type bottom-sheet
  vehicleSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 20, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#88888844", alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 16 },
  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  vehicleGridItem: {
    width: "47%", borderRadius: 14, borderWidth: 1.5,
    paddingVertical: 14, paddingHorizontal: 12,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  vehicleGridEmoji: { fontSize: 28 },
  vehicleGridLabel: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center" },
  vehicleGridCheck: { position: "absolute", top: 8, right: 8 },
});
