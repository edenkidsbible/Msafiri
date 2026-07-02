import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { CommunityReport } from "@/context/AppContext";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";

type ReportType = CommunityReport["type"];

export interface ReportLocation {
  lat: number;
  lng: number;
  label: string;
}

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (type: ReportType, speedLimit?: number, location?: ReportLocation) => void;
  currentLat?: number | null;
  currentLng?: number | null;
}

const TYPES: Array<{
  type: ReportType;
  label: string;
  emoji: string;
  color: string;
}> = [
  { type: "camera",    label: "Speed Camera",  emoji: "📷",  color: "#E53935" },
  { type: "police",    label: "Police Check",   emoji: "👮",  color: "#1565C0" },
  { type: "alcoblow",  label: "Alcoblow",       emoji: "🍺",  color: "#283593" },
  { type: "accident",  label: "Accident",       emoji: "💥",  color: "#B71C1C" },
  { type: "traffic",   label: "Traffic Jam",    emoji: "🚦",  color: "#C62828" },
  { type: "roadblock", label: "Roadblock",      emoji: "🚧",  color: "#7B1FA2" },
  { type: "roadworks", label: "Road Works",     emoji: "👷",  color: "#FBC02D" },
  { type: "hazard",    label: "Hazard",         emoji: "⚠️",  color: "#FF6F00" },
  { type: "pothole",   label: "Pothole",        emoji: "🕳️",  color: "#F57C00" },
  { type: "debris",    label: "Debris",         emoji: "🪨",  color: "#795548" },
  { type: "breakdown", label: "Broken Down",    emoji: "🚗",  color: "#FF8F00" },
  { type: "weather",   label: "Bad Weather",    emoji: "🌧️",  color: "#37474F" },
  { type: "closure",   label: "Road Closed",    emoji: "🛑",  color: "#880E4F" },
  { type: "clear",     label: "Road Clear",     emoji: "✅",  color: "#00C853" },
];

export default function ReportModal({
  visible,
  onClose,
  onSubmit,
  currentLat = null,
  currentLng = null,
}: ReportModalProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState<ReportType | null>(null);
  const [speedLimit, setSpeedLimit] = useState("");

  const hasCurrentLocation = currentLat != null && currentLng != null;
  const [locationMode, setLocationMode] = useState<"current" | "search">("current");
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<GeoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<ReportLocation | null>(null);
  const [editingSearch, setEditingSearch] = useState(true);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  const selItem = TYPES.find((t) => t.type === sel);

  const reset = () => {
    setSel(null);
    setSpeedLimit("");
    setLocationMode("current");
    setSearchText("");
    setSearchResults([]);
    setSearchError(false);
    setPickedLocation(null);
    setEditingSearch(true);
  };

  const runSearch = async (text: string) => {
    if (text.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    setSearchError(false);
    try {
      const results = await nominatimSearch(text);
      setSearchResults(results);
    } catch {
      setSearchError(true);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    setPickedLocation(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(() => runSearch(text), 500);
  };

  const pickResult = (r: GeoResult) => {
    Keyboard.dismiss();
    setPickedLocation({ lat: r.lat, lng: r.lng, label: r.short });
    setSearchText(r.short);
    setSearchResults([]);
    setEditingSearch(false);
  };

  const editSearch = () => {
    setEditingSearch(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const selectMode = (mode: "current" | "search") => {
    setLocationMode(mode);
    if (mode === "current") {
      Keyboard.dismiss();
      setSearchText("");
      setSearchResults([]);
      setPickedLocation(null);
      setSearchError(false);
      setEditingSearch(true);
    } else {
      setEditingSearch(true);
    }
  };

  const canSubmit = !!sel && (locationMode === "current" ? hasCurrentLocation : !!pickedLocation);

  const submit = () => {
    if (!canSubmit || !sel) return;
    const limit = sel === "camera" && speedLimit.trim()
      ? parseInt(speedLimit.trim(), 10)
      : undefined;
    const location = locationMode === "search" && pickedLocation ? pickedLocation : undefined;
    onSubmit(sel, isNaN(limit as number) ? undefined : limit, location);
    reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const topInset = Platform.OS === "web" ? 24 : insets.top;
  const bottomInset = Platform.OS === "web" ? 24 : insets.bottom;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={[styles.screen, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: topInset + 10, borderBottomColor: c.border }]}>
          <TouchableOpacity onPress={handleClose} style={styles.headerBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.headerBtnTxt, { color: c.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Report an Incident</Text>
          <View style={styles.headerBtn} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={topInset}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Location section */}
            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>WHERE IS THIS HAPPENING?</Text>
            <View style={[styles.locToggle, { backgroundColor: c.muted }]}>
              <TouchableOpacity
                style={[styles.locToggleBtn, locationMode === "current" && { backgroundColor: c.card }]}
                onPress={() => selectMode("current")}
                activeOpacity={0.8}
              >
                <Ionicons name="navigate" size={14} color={locationMode === "current" ? c.primary : c.mutedForeground} />
                <Text style={[styles.locToggleTxt, { color: locationMode === "current" ? c.primary : c.mutedForeground }]}>
                  Current Location
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locToggleBtn, locationMode === "search" && { backgroundColor: c.card }]}
                onPress={() => selectMode("search")}
                activeOpacity={0.8}
              >
                <Ionicons name="search" size={14} color={locationMode === "search" ? c.primary : c.mutedForeground} />
                <Text style={[styles.locToggleTxt, { color: locationMode === "search" ? c.primary : c.mutedForeground }]}>
                  Search Location
                </Text>
              </TouchableOpacity>
            </View>

            {locationMode === "current" && (
              hasCurrentLocation ? (
                <View style={[styles.currentRow, { backgroundColor: c.primary + "10", borderColor: c.primary + "33" }]}>
                  <Ionicons name="locate" size={16} color={c.primary} />
                  <Text style={[styles.currentTxt, { color: c.foreground }]}>Using your current GPS location</Text>
                </View>
              ) : (
                <View style={[styles.locHint, { backgroundColor: "#F5730012", borderColor: "#F5730044" }]}>
                  <Ionicons name="alert-circle-outline" size={15} color="#F57300" />
                  <Text style={[styles.locHintTxt, { color: c.mutedForeground }]}>
                    Your current location isn't available yet — try "Search Location" instead.
                  </Text>
                </View>
              )
            )}

            {locationMode === "search" && (
              <View>
                {pickedLocation && !editingSearch ? (
                  <TouchableOpacity
                    style={[styles.pickedSummary, { backgroundColor: c.primary + "12", borderColor: c.primary + "44" }]}
                    onPress={editSearch}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="checkmark-circle" size={16} color={c.primary} />
                    <Text style={[styles.pickedSummaryTxt, { color: c.foreground }]} numberOfLines={1}>
                      {pickedLocation.label}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={c.mutedForeground} />
                  </TouchableOpacity>
                ) : (
                  <>
                    <View style={[styles.searchInputWrap, { borderColor: c.border, backgroundColor: c.card }]}>
                      <Ionicons name="search-outline" size={16} color={c.mutedForeground} />
                      <TextInput
                        ref={searchInputRef}
                        style={[styles.searchInput, { color: c.foreground }]}
                        placeholder="Search road, area, or landmark…"
                        placeholderTextColor={c.mutedForeground}
                        value={searchText}
                        onChangeText={handleSearchChange}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                        autoFocus={editingSearch}
                        onSubmitEditing={() => searchText.length > 1 && runSearch(searchText)}
                      />
                      {searchLoading && <ActivityIndicator size="small" color={c.primary} />}
                      {!!searchText && !searchLoading && (
                        <TouchableOpacity onPress={() => handleSearchChange("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={16} color={c.mutedForeground} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {searchError && (
                      <View style={styles.resultHint}>
                        <Ionicons name="cloud-offline-outline" size={14} color="#F57C00" />
                        <Text style={[styles.resultHintTxt, { color: c.mutedForeground }]}>
                          Search unavailable — check your connection
                        </Text>
                      </View>
                    )}

                    {!searchError && searchResults.length === 0 && !searchLoading && searchText.length > 1 && (
                      <View style={styles.resultHint}>
                        <Ionicons name="location-outline" size={14} color={c.mutedForeground} />
                        <Text style={[styles.resultHintTxt, { color: c.mutedForeground }]}>
                          No places found for "{searchText}"
                        </Text>
                      </View>
                    )}

                    {searchResults.length > 0 && (
                      <View style={[styles.resultsList, { borderColor: c.border, backgroundColor: c.card }]}>
                        {searchResults.map((item, index) => (
                          <TouchableOpacity
                            key={index}
                            style={[
                              styles.resultRow,
                              { borderBottomColor: c.border },
                              index === searchResults.length - 1 && { borderBottomWidth: 0 },
                            ]}
                            onPress={() => pickResult(item)}
                            activeOpacity={0.72}
                          >
                            <Ionicons name="location-outline" size={14} color={c.primary} />
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.resultName, { color: c.foreground }]} numberOfLines={1}>
                                {item.short}
                              </Text>
                              <Text style={[styles.resultSub, { color: c.mutedForeground }]} numberOfLines={1}>
                                {item.display.split(",").slice(2).join(",").trim()}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            )}

            {/* Incident type */}
            <Text style={[styles.sectionLabel, { color: c.mutedForeground, marginTop: 22 }]}>WHAT DO YOU SEE?</Text>
            <View style={styles.grid}>
              {TYPES.map((t) => {
                const active = sel === t.type;
                return (
                  <TouchableOpacity
                    key={t.type}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? t.color + "18" : c.muted,
                        borderColor: active ? t.color : c.border,
                      },
                    ]}
                    onPress={() => { setSel(t.type); setSpeedLimit(""); }}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.chipIconWrap, { backgroundColor: t.color + (active ? "30" : "18") }]}>
                      <Text style={styles.chipEmoji}>{t.emoji}</Text>
                    </View>
                    <Text
                      style={[
                        styles.chipLabel,
                        { color: active ? t.color : c.foreground },
                        active && { fontFamily: "Inter_600SemiBold" },
                      ]}
                      numberOfLines={1}
                    >
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Speed limit field — appears when "Speed Camera" is selected */}
            {sel === "camera" && (
              <View style={[styles.speedRow, { backgroundColor: "#E5393512", borderColor: "#E5393544" }]}>
                <Ionicons name="speedometer-outline" size={18} color="#E53935" />
                <Text style={[styles.speedLabel, { color: "#E53935" }]}>Speed limit at this camera:</Text>
                <View style={[styles.speedInputWrap, { borderColor: "#E5393566", backgroundColor: c.card }]}>
                  <TextInput
                    style={[styles.speedInput, { color: c.foreground }]}
                    value={speedLimit}
                    onChangeText={(v) => setSpeedLimit(v.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    placeholder="km/h"
                    placeholderTextColor={c.mutedForeground}
                    maxLength={3}
                    returnKeyType="done"
                  />
                </View>
                <Text style={[styles.speedOptional, { color: c.mutedForeground }]}>optional</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background, paddingBottom: bottomInset + 14 }]}>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: canSubmit ? (selItem?.color ?? c.primary) : c.muted }]}
              onPress={submit}
              disabled={!canSubmit}
            >
              {selItem && <Text style={styles.submitEmoji}>{selItem.emoji}</Text>}
              <Text style={[styles.submitTxt, { color: canSubmit ? "#FFF" : c.mutedForeground }]}>
                {!sel
                  ? "Select an incident type above"
                  : locationMode === "search" && !pickedLocation
                    ? "Pick a location above"
                    : `Report ${selItem?.label}`}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { minWidth: 56 },
  headerBtnTxt: { fontSize: 15, fontFamily: "Inter_500Medium" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },

  body: { padding: 20, paddingBottom: 32 },

  sectionLabel: { fontSize: 11.5, fontFamily: "Inter_700Bold", letterSpacing: 0.4, marginBottom: 10 },

  locToggle: {
    flexDirection: "row", borderRadius: 12, padding: 3, marginBottom: 12, gap: 3,
  },
  locToggleBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  locToggleTxt: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },

  currentRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  currentTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },

  locHint: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 10,
  },
  locHintTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },

  searchInputWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  pickedSummary: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  pickedSummaryTxt: { fontSize: 13.5, fontFamily: "Inter_600SemiBold", flex: 1 },

  resultHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 10, paddingHorizontal: 2,
  },
  resultHintTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },

  resultsList: { borderWidth: 1, borderRadius: 12, marginTop: 8, overflow: "hidden" },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: { fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  resultSub: { fontSize: 11.5, fontFamily: "Inter_400Regular", marginTop: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1.5, width: "47%",
  },
  chipIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chipLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1 },

  speedRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11,
    marginTop: 16,
    flexWrap: "wrap",
  },
  speedLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  speedInputWrap: {
    borderWidth: 1.5, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
    minWidth: 68,
  },
  speedInput: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center", minWidth: 52 },
  speedOptional: { fontSize: 11, fontFamily: "Inter_400Regular" },

  chipEmoji: { fontSize: 17, lineHeight: 22 },
  submitEmoji: { fontSize: 16, lineHeight: 20 },

  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 14 },
  submitBtn: {
    paddingVertical: 15, borderRadius: 14,
    alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
  },
  submitTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
