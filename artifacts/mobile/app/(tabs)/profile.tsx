import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, Alert, Share, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useSubscription } from "@/hooks/useSubscription";
import { apiGet } from "@/utils/apiClient";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import Constants from "expo-constants";
export { ErrorBoundary } from "@/components/ErrorBoundary";


function SettingsRow({
  icon,
  iconColor,
  title,
  sub,
  badge,
  badgeColor,
  onPress,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  sub: string;
  badge?: string;
  badgeColor?: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const c = useColors();
  return (
    <>
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
        <View style={[styles.rowIcon, { backgroundColor: iconColor + "22" }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: c.foreground }]}>{title}</Text>
          <Text style={[styles.rowSub, { color: c.mutedForeground }]} numberOfLines={1}>{sub}</Text>
        </View>
        {badge ? (
          <Text style={[styles.rowBadge, { color: badgeColor || c.mutedForeground }]}>{badge}</Text>
        ) : null}
        <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} style={{ marginLeft: 8 }} />
      </TouchableOpacity>
      {!isLast && <View style={[styles.rowDivider, { backgroundColor: c.border }]} />}
    </>
  );
}

export default function ProfileScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tabBarH = Platform.OS === "web" ? 84 : 96;
  
  const { driverName, clearAllData, deviceId, profilePhotoUri } = useApp();
  const { isSubscribed, customerInfo } = useSubscription();
  const version = Constants.expoConfig?.version ?? "2.1.0";

  // Saved profile details — reloaded on focus so edits made on the
  // Personal Information screen show up immediately when returning here.
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [emergencyContactCount, setEmergencyContactCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([
        AsyncStorage.getItem("profile_email"),
        AsyncStorage.getItem("profile_phone"),
      ]).then(([email, phone]) => {
        if (!active) return;
        setProfileEmail(email ?? "");
        setProfilePhone(phone ?? "");
      }).catch(() => {});

      // Fetch real emergency contact count
      if (deviceId) {
        apiGet<{ contacts: { id: string }[] }>(`/emergency-contacts?deviceId=${deviceId}`)
          .then((res) => {
            if (!active) return;
            setEmergencyContactCount(res?.contacts?.length ?? 0);
          })
          .catch(() => {});
      }

      return () => { active = false; };
    }, [deviceId])
  );

  const handleLogout = () => {
    Alert.alert(
      "Log Out",
      "Are you sure you want to log out of your account?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Log Out", style: "destructive", onPress: () => clearAllData() },
      ]
    );
  };

  const handleInvite = async () => {
    try {
      await Share.share({
        message: "Join me on Msafiri Kenya! Smarter roads, safer journeys.",
      });
    } catch (error) {
      // Ignore
    }
  };

  const initials = driverName ? driverName.substring(0, 2).toUpperCase() : "DR";

  // Derive the real renewal/expiration date from RevenueCat customer info.
  // expirationDate is an ISO string (e.g. "2026-08-01T00:00:00Z") or null for lifetime.
  const renewalDateLabel = (() => {
    if (!isSubscribed) return null;
    const expiresDate =
      customerInfo?.entitlements.active?.["pro"]?.expirationDate;
    if (!expiresDate) return null; // lifetime or unavailable
    const d = new Date(expiresDate);
    if (isNaN(d.getTime())) return null;
    return "Renews on " + d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  })();

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 14,
        paddingBottom: tabBarH + insets.bottom + 24,
      }} showsVerticalScrollIndicator={false}>
        
        {/* Header Row */}
        <View style={[styles.headerRow, { paddingHorizontal: 16 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: c.foreground }]}>Profile</Text>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>
              Manage your account and stay in control.
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: c.card, borderColor: c.tileBorder }]}
              onPress={() => router.push("/app-settings/notifications" as any)}
            >
              <Ionicons name="notifications-outline" size={20} color={c.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Profile Header Card */}
        <TouchableOpacity 
          activeOpacity={0.8}
          style={[styles.profileCard, { backgroundColor: c.card, borderColor: c.tileBorder, marginHorizontal: 16 }]}
          onPress={() => router.push("/personal-information" as any)}
        >
          <View style={[styles.avatarWrap, { backgroundColor: c.primary + "1E" }]}>
            {profilePhotoUri ? (
              <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
            ) : (
              <Text style={[styles.avatarTxt, { color: c.primary }]}>{initials}</Text>
            )}
            <View style={[styles.avatarBadge, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
              <Ionicons name="camera" size={10} color={c.foreground} />
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <Text style={[styles.profileName, { color: c.foreground }]} numberOfLines={1}>
                {driverName || "Driver"}
              </Text>
              <View style={[styles.verifiedPill, { backgroundColor: c.primary + "22" }]}>
                <Text style={[styles.verifiedTxt, { color: c.primary }]}>Verified Driver ✓</Text>
              </View>
            </View>
            <Text style={[styles.profileInfo, { color: c.mutedForeground }]} numberOfLines={1}>
              {profileEmail || "Add your email"}
            </Text>
            <Text style={[styles.profileInfo, { color: c.mutedForeground, marginTop: 1 }]} numberOfLines={1}>
              {profilePhone ? (
                <><Text style={{ fontFamily: EMOJI_FONT_FAMILY }}>🇰🇪</Text> {profilePhone}</>
              ) : (
                "Add your phone number"
              )}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.mutedForeground} />
        </TouchableOpacity>

        {/* Premium Status Card */}
        <View style={[
          styles.premiumCard, 
          { backgroundColor: c.card, borderColor: c.tileBorder, borderLeftWidth: 4, borderLeftColor: c.primary, marginHorizontal: 16 }
        ]}>
          <View style={[styles.premiumIconWrap, { backgroundColor: c.primary + "22" }]}>
            <Ionicons name="shield-checkmark" size={22} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <Text style={[styles.premiumTitle, { color: c.foreground }]}>Msafiri Premium</Text>
              {isSubscribed && (
                <View style={[styles.activePill, { backgroundColor: c.primary + "22" }]}>
                  <Text style={[styles.activeTxt, { color: c.primary }]}>Active</Text>
                </View>
              )}
            </View>
            <Text style={[styles.premiumSub, { color: c.mutedForeground }]} numberOfLines={1}>
              {isSubscribed ? "You're enjoying all Premium benefits" : "Unlock exclusive features today"}
            </Text>
            {(isSubscribed ? (renewalDateLabel ?? "") : "Subscribe now") ? (
              <Text style={[styles.premiumDate, { color: c.primary }]} numberOfLines={1}>
                {isSubscribed ? (renewalDateLabel ?? "") : "Subscribe now"}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity style={[styles.manageBtn, { borderColor: c.border }]} onPress={() => router.push("/paywall" as any)}>
            <Text style={[styles.manageBtnTxt, { color: c.foreground }]}>{isSubscribed ? "Manage >" : "Subscribe >"}</Text>
          </TouchableOpacity>
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.foreground, marginHorizontal: 16 }]}>Account</Text>
          <View style={[styles.sectionGroup, { backgroundColor: c.card, borderColor: c.tileBorder, marginHorizontal: 16 }]}>
            <SettingsRow 
              icon="person-outline" iconColor="#3B82F6" 
              title="Personal Information" sub="Update your details" 
              onPress={() => router.push("/personal-information" as any)} 
            />
            <SettingsRow 
              icon="card-outline" iconColor={c.primary} 
              title="Subscription" sub="Manage your plan and billing" 
              badge="Premium" badgeColor={c.primary}
              onPress={() => router.push("/paywall" as any)} 
            />
            <SettingsRow 
              icon="gift-outline" iconColor="#8B5CF6" 
              title="Invite Friends" sub="Invite and earn rewards" 
              onPress={handleInvite}
              isLast
            />
          </View>
        </View>

        {/* Safety & Settings Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.foreground, marginHorizontal: 16 }]}>Safety & Settings</Text>
          <View style={[styles.sectionGroup, { backgroundColor: c.card, borderColor: c.tileBorder, marginHorizontal: 16 }]}>
            <SettingsRow 
              icon="shield-outline" iconColor="#F97316" 
              title="Emergency Contacts" sub="Add and manage contacts" 
              badge={emergencyContactCount !== null && emergencyContactCount > 0
                ? `${emergencyContactCount} contact${emergencyContactCount !== 1 ? "s" : ""}`
                : undefined}
              onPress={() => router.push("/app-settings/emergency-contacts" as any)} 
            />
            <SettingsRow 
              icon="notifications-outline" iconColor="#EF4444" 
              title="Notifications" sub="Manage your alerts and updates" 
              onPress={() => router.push("/app-settings/notifications" as any)} 
            />
            <SettingsRow 
              icon="volume-high-outline" iconColor="#3B82F6" 
              title="Voice & Sound" sub="Manage voice alerts and sounds" 
              onPress={() => router.push("/app-settings/voice-sound" as any)} 
            />
            <SettingsRow 
              icon="moon-outline" iconColor="#8B5CF6" 
              title="Appearance" sub="Choose your theme" 
              badge={c.isDark ? "Dark Mode" : "Light Mode"} badgeColor={c.primary}
              onPress={() => router.push("/app-settings/appearance" as any)}
              isLast
            />
          </View>
        </View>

        {/* Support & More Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.foreground, marginHorizontal: 16 }]}>Support & More</Text>
          <View style={[styles.sectionGroup, { backgroundColor: c.card, borderColor: c.tileBorder, marginHorizontal: 16 }]}>
            <SettingsRow 
              icon="help-circle-outline" iconColor="#3B82F6" 
              title="Help Center" sub="FAQs and support" 
              onPress={() => Linking.openURL("https://msafirikenya.com").catch(() => {})} 
            />
            <SettingsRow 
              icon="school-outline" iconColor="#F59E0B" 
              title="Driver Safety Course" sub="Manage your driving skills" 
              onPress={() => router.push("/(tabs)/learn")} 
            />
            <SettingsRow 
              icon="information-circle-outline" iconColor="#6B7280" 
              title="About Msafiri" sub="App info, terms and privacy" 
              badge={`v${version}`}
              onPress={() => router.push("/about" as any)} 
              isLast
            />
          </View>
        </View>

        {/* Log Out */}
        <View style={{ marginHorizontal: 16, marginTop: 10 }}>
          <TouchableOpacity 
            style={[styles.logoutBtn, { backgroundColor: c.destructive + "18", borderColor: c.destructive + "44" }]}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={20} color={c.destructive} />
            <Text style={[styles.logoutTxt, { color: c.destructive }]}>Log Out</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 3 },
  headerActions: { flexDirection: "row", gap: 10 },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1,
    alignItems: "center", justifyContent: "center"
  },

  profileCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 20,
  },
  avatarWrap: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: "center", justifyContent: "center",
  },
  avatarImage: { width: 60, height: 60, borderRadius: 30 },
  avatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold" },
  avatarBadge: {
    position: "absolute", bottom: -2, right: -2,
    width: 22, height: 22, borderRadius: 11, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  verifiedPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  verifiedTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },
  profileInfo: { fontSize: 13, fontFamily: "Inter_400Regular" },

  premiumCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24,
  },
  premiumIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  premiumTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  activePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  activeTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },
  premiumSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 2 },
  premiumDate: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  manageBtn: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
  },
  manageBtnTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 12 },
  sectionGroup: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowBadge: { fontSize: 12, fontFamily: "Inter_500Medium" },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: 66 }, // indent divider to align with text

  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 16, borderWidth: 1, padding: 16,
  },
  logoutTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
