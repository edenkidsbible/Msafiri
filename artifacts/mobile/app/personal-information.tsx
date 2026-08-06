export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useEffect, useState } from "react";
import { Alert, Image, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { getVehicleTypeDef } from "@/data/vehicleTypes";

export default function PersonalInformationScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { driverName, setDriverName, vehicleType } = useApp();

  const [name, setName] = useState(driverName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("profile_email").then(val => { if (val) setEmail(val); });
    AsyncStorage.getItem("profile_phone").then(val => { if (val) setPhone(val); });
    AsyncStorage.getItem("profile_photo_uri").then(val => { if (val) setPhotoUri(val); });
  }, []);

  const handleChangePhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo library access to set a profile photo.");
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
    } catch (e) {
      console.warn("Change photo error:", e);
      Alert.alert("Error", "Could not update your photo. Please try again.");
    }
  };

  const vehicleLabel = getVehicleTypeDef(vehicleType).label;
  const initials = name ? name.substring(0, 2).toUpperCase() : "DR";

  const handleSave = async () => {
    setDriverName(name);
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

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
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
            <Text style={[styles.label, { color: c.mutedForeground }]}>Full Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={c.mutedForeground}
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
            <Text style={[styles.label, { color: c.mutedForeground }]}>Phone Number</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.muted, color: c.foreground }]}
              value={phone}
              onChangeText={setPhone}
              placeholder="+254 7XX XXX XXX"
              placeholderTextColor={c.mutedForeground}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>Vehicle Type</Text>
            <TouchableOpacity 
              style={[styles.input, styles.readOnlyRow, { backgroundColor: c.muted }]}
              onPress={() => router.push("/(tabs)/settings")}
              activeOpacity={0.7}
            >
              <Text style={{ color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}>{vehicleLabel}</Text>
              <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
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
      </ScrollView>
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
});
