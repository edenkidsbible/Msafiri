export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { setAlertVoiceDisabled, getAlertVoiceDisabled } from "@/utils/alertTts";
import { setSoundsMuted, getSoundsMuted } from "@/utils/sound";

export default function VoiceSoundScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  
  const [voiceDisabled, setVoiceDisabled] = useState(false);
  const [soundsDisabled, setSoundsDisabled] = useState(false);

  useEffect(() => {
    // Initial sync with global vars / AsyncStorage
    setVoiceDisabled(getAlertVoiceDisabled());
    setSoundsDisabled(getSoundsMuted());
    
    // Also fetch from AsyncStorage directly to be sure
    AsyncStorage.getItem("voice_alerts_disabled").then(val => {
      if (val !== null) setVoiceDisabled(val === "true");
    });
    AsyncStorage.getItem("sounds_muted").then(val => {
      if (val !== null) setSoundsDisabled(val === "true");
    });
  }, []);

  const handleVoiceToggle = async (value: boolean) => {
    const disabled = !value; // value is ON (true = not disabled)
    setVoiceDisabled(disabled);
    setAlertVoiceDisabled(disabled);
    await AsyncStorage.setItem("voice_alerts_disabled", disabled.toString());
  };

  const handleSoundToggle = async (value: boolean) => {
    const disabled = !value; // value is ON (true = not muted)
    setSoundsDisabled(disabled);
    setSoundsMuted(disabled);
    await AsyncStorage.setItem("sounds_muted", disabled.toString());
  };

  const ToggleRow = ({ title, sub, icon, iconColor, value, onToggle, isLast }: any) => {
    return (
      <View>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: iconColor + "22" }]}>
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: c.foreground }]}>{title}</Text>
            <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{sub}</Text>
          </View>
          <Switch
            value={value}
            onValueChange={onToggle}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor="#fff"
          />
        </View>
        {!isLast && <View style={[styles.divider, { backgroundColor: c.border }]} />}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Voice & Sound</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Manage how Msafiri communicates with you</Text>
        
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Voice Guidance</Text>
        <View style={[styles.cardGroup, { backgroundColor: c.card }]}>
          <ToggleRow 
            title="Voice Alerts" 
            sub="Spoken alerts for cameras, police, and hazards" 
            icon="mic-outline" 
            iconColor={c.primary} 
            value={!voiceDisabled}
            onToggle={handleVoiceToggle} 
          />
          <ToggleRow 
            title="Navigation Voice" 
            sub="Turn-by-turn voice directions" 
            icon="navigate-outline" 
            iconColor="#3B82F6" 
            value={!voiceDisabled}
            onToggle={handleVoiceToggle} 
            isLast 
          />
        </View>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Sound Effects</Text>
        <View style={[styles.cardGroup, { backgroundColor: c.card }]}>
          <ToggleRow 
            title="Sound Effects" 
            sub="Chimes and notification sounds" 
            icon="volume-high-outline" 
            iconColor="#F97316" 
            value={!soundsDisabled}
            onToggle={handleSoundToggle} 
          />
          <ToggleRow 
            title="Alert Tones" 
            sub="Audio tones for critical alerts" 
            icon="musical-notes-outline" 
            iconColor="#8B5CF6" 
            value={!soundsDisabled}
            onToggle={handleSoundToggle} 
            isLast 
          />
        </View>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Audio Output</Text>
        <View style={[styles.cardGroup, { backgroundColor: c.card }]}>
          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: c.muted }]}>
              <Ionicons name="bluetooth-outline" size={20} color={c.mutedForeground} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowSub, { color: c.mutedForeground }]}>
                Audio plays through your device speaker or connected Bluetooth device. Adjust volume with your device buttons.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginTop: 20, paddingHorizontal: 20, textTransform: "uppercase" },
  cardGroup: { borderRadius: 16, overflow: "hidden", marginBottom: 4, marginHorizontal: 16 },
  
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  rowText: { flex: 1, minWidth: 0, paddingRight: 8 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
});
