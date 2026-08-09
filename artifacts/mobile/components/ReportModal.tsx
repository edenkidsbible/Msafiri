import React, { useEffect, useMemo, useRef, useState } from "react";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import * as Haptics from "expo-haptics";
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
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { CommunityReport, useApp } from "@/context/AppContext";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";
import { snapToRoad } from "@/utils/snapToRoad";
// CrosshairPickerModal is intentionally NOT rendered inside ReportModal.
// It lives at the drive screen root (index.tsx) to avoid a nested-Modal on iOS
// and the two-concurrent-MapView native crash. ReportModal calls onOpenMapPicker
// to request the picker; the parent wires the CrosshairPickerModal there.

type ReportType = CommunityReport["type"];

// Fixed speed-limit choices for speed camera reports (30–110 km/h in the
// same 10 km/h steps NTSA limits use) — replaces free-form numeric entry.
const SPEED_LIMIT_OPTIONS = [30, 40, 50, 60, 70, 80, 90, 100, 110];

/** Observation metadata collected alongside the report. */
export interface ObservationMeta {
  observationContext: "on_location" | "recent_nearby" | "community_tip";
  observedAt: number;              // epoch ms when reporter says they saw it
  reporterProximityM?: number;     // straight-line metres from reporter's GPS to pin
}

type WhenSeen = "now" | "hour" | "today" | "earlier";

const WHEN_SEEN_OPTIONS: Array<{ value: WhenSeen; label: string; icon: string }> = [
  { value: "now",    label: "Just now",           icon: "🔴" },
  { value: "hour",   label: "Within the last hour", icon: "🟡" },
  { value: "today",  label: "Earlier today",      icon: "🟠" },
  { value: "earlier",label: "A while ago",        icon: "⚪" },
];

/** Haversine distance in metres between two coordinates. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface ReportLocation {
  lat: number;
  lng: number;
  label: string;
}

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (type: ReportType, speedLimit?: number, location?: ReportLocation, meta?: ObservationMeta) => void;
  currentLat?: number | null;
  currentLng?: number | null;
  initialType?: ReportType | null; // NEW — pre-selects this type when modal opens
  /** Called when the user wants to open the crosshair map picker. The parent
   *  renders CrosshairPickerModal at the root level so it is never nested
   *  inside another Modal (which causes silent iOS presentation failures). */
  onOpenMapPicker: (initialLat: number, initialLng: number, onConfirm: (lat: number, lng: number) => void) => void;
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
  initialType = null,
  onOpenMapPicker,
}: ReportModalProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { tripHistory, isAdmin } = useApp();
  const [sel, setSel] = useState<ReportType | null>(null);
  const [speedLimit, setSpeedLimit] = useState("");
  const [whenSeen, setWhenSeen] = useState<WhenSeen | null>(null);

  const hasCurrentLocation = currentLat != null && currentLng != null;
  const [locationMode, setLocationMode] = useState<"current" | "search" | "map">("current");
  const [pickedMapLocation, setPickedMapLocation] = useState<ReportLocation | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<GeoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [pickedLocation, setPickedLocation] = useState<ReportLocation | null>(null);
  const [editingSearch, setEditingSearch] = useState(true);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  const selItem = TYPES.find((t) => t.type === sel);

  // Auto-close if the modal is left open with no interaction — a driver who
  // got distracted mid-report shouldn't come back to a stale screen blocking
  // the map. Any tap/typing below resets the clock via bumpIdleTimer().
  const IDLE_CLOSE_MS = 25000;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearIdleTimer = () => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
  };
  const bumpIdleTimer = () => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => handleClose(), IDLE_CLOSE_MS);
  };
  useEffect(() => {
    if (visible) bumpIdleTimer(); else clearIdleTimer();
    return clearIdleTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Pre-select the initialType when the modal becomes visible
  useEffect(() => {
    if (visible && initialType) {
      setSel(initialType);
      setSpeedLimit("");
    }
  }, [visible, initialType]);

  const reset = () => {
    setSel(null);
    setSpeedLimit("");
    setLocationMode("current");
    setSearchText("");
    setSearchResults([]);
    setSearchError(false);
    setPickedLocation(null);
    setPickedMapLocation(null);
    setEditingSearch(true);
    setWhenSeen(null);
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
    bumpIdleTimer();
    setSearchText(text);
    setPickedLocation(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(() => runSearch(text), 500);
  };

  const pickResult = async (r: GeoResult) => {
    bumpIdleTimer();
    Keyboard.dismiss();
    setSearchText(r.short);
    setSearchResults([]);
    setEditingSearch(false);
    // Set geocoded coords immediately for responsiveness
    setPickedLocation({ lat: r.lat, lng: r.lng, label: r.short });
    // Silently snap to the nearest road centerline
    const snapped = await snapToRoad(r.lat, r.lng);
    setPickedLocation({ lat: snapped.lat, lng: snapped.lng, label: r.short });
  };

  const editSearch = () => {
    bumpIdleTimer();
    setEditingSearch(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const selectMode = (mode: "current" | "search" | "map") => {
    bumpIdleTimer();
    setLocationMode(mode);
    setWhenSeen(null); // reset observation time when switching location mode
    if (mode === "current") {
      Keyboard.dismiss();
      setSearchText("");
      setSearchResults([]);
      setPickedLocation(null);
      setSearchError(false);
      setEditingSearch(true);
    } else if (mode === "map") {
      Keyboard.dismiss();
      // Launch the full-screen crosshair picker immediately if nothing picked yet.
      if (!pickedMapLocation) {
        onOpenMapPicker(
          currentLat ?? -1.2921,
          currentLng ?? 36.8219,
          (lat, lng) => {
            bumpIdleTimer();
            setPickedMapLocation({ lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
          },
        );
      }
    } else {
      setEditingSearch(true);
    }
  };

  // ── Observation context ─────────────────────────────────────────────────────
  // "When did you see this?" is always asked regardless of location mode so
  // every report carries accurate freshness metadata.
  // "Just now" → on_location (eyewitness), "last hour" → recent_nearby,
  // "today" / "earlier" → community_tip.
  const observationContext: ObservationMeta["observationContext"] =
    whenSeen === "now"
      ? "on_location"
      : whenSeen === "hour"
        ? "recent_nearby"
        : "community_tip";

  const observedAtMs: number =
    !whenSeen || whenSeen === "now"
      ? Date.now()
      : whenSeen === "hour"
        ? Date.now() - 45 * 60 * 1000
        : whenSeen === "today"
          ? (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d.getTime(); })()
          : Date.now() - 4 * 3600 * 1000; // "earlier" — roughly 4 h ago

  // Location is "ready" when enough info exists to resolve it
  const locationReady =
    locationMode === "current" ? hasCurrentLocation :
    locationMode === "search"  ? !!pickedLocation :
    locationMode === "map"     ? !!pickedMapLocation : false;

  // Always ask when the reporter observed this — applies to all location modes.
  const needsWhenSeen = true;
  const canSubmit = !!sel && locationReady && !!whenSeen;

  const doSubmit = (type: ReportType, limit?: number, location?: ReportLocation) => {
    clearIdleTimer();
    const proximityM =
      locationMode !== "current" && currentLat != null && currentLng != null && location
        ? Math.round(haversineM(currentLat, currentLng, location.lat, location.lng))
        : undefined;
    const meta: ObservationMeta = {
      observationContext,
      observedAt: observedAtMs,
      ...(proximityM != null ? { reporterProximityM: proximityM } : {}),
    };
    onSubmit(type, limit, location, meta);
    reset();
  };

  const submit = () => {
    if (!canSubmit || !sel) return;
    const limit = sel === "camera" && speedLimit.trim()
      ? parseInt(speedLimit.trim(), 10)
      : undefined;
    const location =
      locationMode === "search" && pickedLocation ? pickedLocation :
      locationMode === "map" && pickedMapLocation ? pickedMapLocation :
      undefined;
    doSubmit(sel, isNaN(limit as number) ? undefined : limit, location);
  };

  // Every report goes through the full flow: location → when seen → type →
  // submit. One-tap chip submission is intentionally removed so the
  // "When did you see this?" step is never bypassed.

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
            {...SCROLL_PROPS}
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
                  Here
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locToggleBtn, locationMode === "search" && { backgroundColor: c.card }]}
                onPress={() => selectMode("search")}
                activeOpacity={0.8}
              >
                <Ionicons name="search" size={14} color={locationMode === "search" ? c.primary : c.mutedForeground} />
                <Text style={[styles.locToggleTxt, { color: locationMode === "search" ? c.primary : c.mutedForeground }]}>
                  Search
                </Text>
              </TouchableOpacity>
              {Platform.OS !== "web" && (
                <TouchableOpacity
                  style={[styles.locToggleBtn, locationMode === "map" && { backgroundColor: c.card }]}
                  onPress={() => selectMode("map")}
                  activeOpacity={0.8}
                >
                  <Ionicons name="map" size={14} color={locationMode === "map" ? c.primary : c.mutedForeground} />
                  <Text style={[styles.locToggleTxt, { color: locationMode === "map" ? c.primary : c.mutedForeground }]}>
                    Drop Pin
                  </Text>
                </TouchableOpacity>
              )}
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

            {locationMode === "map" && (
              <View style={{ marginTop: 4 }}>
                {pickedMapLocation ? (
                  <TouchableOpacity
                    style={[styles.pickedSummary, { backgroundColor: c.primary + "12", borderColor: c.primary + "44" }]}
                    onPress={() => {
                      bumpIdleTimer();
                      onOpenMapPicker(
                        pickedMapLocation?.lat ?? currentLat ?? -1.2921,
                        pickedMapLocation?.lng ?? currentLng ?? 36.8219,
                        (lat, lng) => {
                          bumpIdleTimer();
                          setPickedMapLocation({ lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
                        },
                      );
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="pin" size={16} color={c.primary} />
                    <Text style={[styles.pickedSummaryTxt, { color: c.foreground }]} numberOfLines={1}>
                      {pickedMapLocation.label}
                    </Text>
                    <Text style={{ fontSize: 12, color: c.primary, fontFamily: "Inter_600SemiBold" }}>Adjust</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.pickedSummary, { backgroundColor: c.card, borderColor: c.border }]}
                    onPress={() => {
                      bumpIdleTimer();
                      onOpenMapPicker(
                        currentLat ?? -1.2921,
                        currentLng ?? 36.8219,
                        (lat, lng) => {
                          bumpIdleTimer();
                          setPickedMapLocation({ lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
                        },
                      );
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="map-outline" size={16} color={c.primary} />
                    <Text style={[styles.pickedSummaryTxt, { color: c.foreground }]}>Choose spot on map</Text>
                    <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
                  </TouchableOpacity>
                )}
                {!pickedMapLocation && (
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 8, paddingHorizontal: 2 }}>
                    <Ionicons name="information-circle-outline" size={14} color={c.mutedForeground} style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: c.mutedForeground, flex: 1, lineHeight: 18 }}>
                      Pan the map to place the pin on the exact spot you observed the incident.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* While in Drop Pin mode and no pin placed yet — prompt instead of showing the incident grid */}
            {locationMode === "map" && !pickedMapLocation && (
              <View style={[styles.pinPrompt, { backgroundColor: c.muted }]}>
                <Ionicons name="pin-outline" size={18} color={c.mutedForeground} />
                <Text style={[styles.pinPromptTxt, { color: c.mutedForeground }]}>
                  Open the map picker above and place the pin on the exact spot
                </Text>
              </View>
            )}

            {/* ── When did you see this? ─────────────────────────────────────
                Shown for Search and Drop Pin modes after a location is chosen.
                Drivers can report from anywhere — we just need to know how
                fresh the observation is so we can display the right confidence
                label to other drivers. */}
            {needsWhenSeen && locationReady && (
              <View style={{ marginTop: 20 }}>
                <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
                  WHEN DID YOU SEE THIS?
                </Text>
                <View style={{ gap: 8 }}>
                  {WHEN_SEEN_OPTIONS.map((opt) => {
                    const active = whenSeen === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.whenSeenRow,
                          {
                            backgroundColor: active ? c.primary + "14" : c.muted,
                            borderColor: active ? c.primary : c.border,
                          },
                        ]}
                        onPress={() => { bumpIdleTimer(); setWhenSeen(opt.value); Haptics.selectionAsync(); }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.whenSeenEmoji}>{opt.icon}</Text>
                        <Text style={[styles.whenSeenLabel, { color: active ? c.primary : c.foreground }]}>
                          {opt.label}
                        </Text>
                        {active && <Ionicons name="checkmark-circle" size={18} color={c.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* Community-tip notice — shown when observation context is not fresh */}
                {(whenSeen === "today" || whenSeen === "earlier") && (
                  <View style={[styles.communityTipNotice, { backgroundColor: "#FF980012", borderColor: "#FF980040" }]}>
                    <Ionicons name="information-circle-outline" size={14} color="#FF9800" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: "#FF9800", flex: 1, lineHeight: 18, fontFamily: "Inter_400Regular" }}>
                      Your report will be labelled{" "}
                      <Text style={{ fontFamily: "Inter_600SemiBold" }}>Community tip</Text>
                      {" "}so other drivers know it's not a live observation. It's still valuable — especially for potholes, roadworks, and cameras.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Incident type grid — shown for non-map modes (or once a map pin is placed)
                AND after the "when did you see it?" question is answered for remote modes */}
            {(locationMode !== "map" || !!pickedMapLocation) && (!needsWhenSeen || !!whenSeen) && (
              sel === "camera" ? (
                /* ── Camera focused view ──────────────────────────────────────
                   When Speed Camera is selected, collapse the full grid and
                   show only the camera card + speed-limit picker so the driver
                   isn't forced to scroll past 13 other chips to reach it.
                ────────────────────────────────────────────────────────────── */
                <>
                  {/* Back link */}
                  <TouchableOpacity
                    style={styles.changeTypeRow}
                    onPress={() => { Haptics.selectionAsync(); bumpIdleTimer(); setSel(null); setSpeedLimit(""); }}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="arrow-back" size={16} color={c.primary} />
                    <Text style={[styles.changeTypeTxt, { color: c.primary }]}>Change incident type</Text>
                  </TouchableOpacity>

                  {/* Selected camera card */}
                  <View style={[styles.cameraCard, { backgroundColor: "#E5393512", borderColor: "#E53935" }]}>
                    <View style={[styles.cameraCardIcon, { backgroundColor: "#E5393530" }]}>
                      <Text style={styles.cameraCardEmoji}>📷</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cameraCardLabel, { color: "#E53935" }]}>Speed Camera</Text>
                      <Text style={[styles.cameraCardHint, { color: c.mutedForeground }]}>
                        Tap a speed limit below, then submit
                      </Text>
                    </View>
                    <Ionicons name="checkmark-circle" size={22} color="#E53935" />
                  </View>

                  {/* Speed limit picker — front and centre */}
                  <View style={[styles.speedSection, { backgroundColor: "#E5393508", borderColor: "#E5393544", marginTop: 12 }]}>
                    <View style={styles.speedSectionHeader}>
                      <Ionicons name="speedometer-outline" size={18} color="#E53935" />
                      <Text style={[styles.speedLabel, { color: "#E53935" }]}>Speed limit at this camera:</Text>
                      <Text style={[styles.speedOptional, { color: c.mutedForeground }]}>optional</Text>
                    </View>
                    <View style={styles.speedChipRow}>
                      {SPEED_LIMIT_OPTIONS.map((limit) => {
                        const active = speedLimit === String(limit);
                        return (
                          <TouchableOpacity
                            key={limit}
                            style={[
                              styles.speedChip,
                              {
                                backgroundColor: active ? "#E53935" : c.card,
                                borderColor: active ? "#E53935" : "#E5393566",
                              },
                            ]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              bumpIdleTimer();
                              setSpeedLimit((prev) => (prev === String(limit) ? "" : String(limit)));
                            }}
                            activeOpacity={0.75}
                          >
                            <Text style={[styles.speedChipTxt, { color: active ? "#FFF" : c.foreground }]}>{limit}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </>
              ) : (
                /* ── Normal incident grid ──────────────────────────────────── */
                <>
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
                          onPress={() => {
                            Haptics.selectionAsync();
                            bumpIdleTimer();
                            setSel(t.type);
                            setSpeedLimit("");
                          }}
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
                </>
              )
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
                {locationMode === "search" && !pickedLocation
                  ? "Pick a location above"
                  : locationMode === "map" && !pickedMapLocation
                    ? "Place a pin on the map above"
                    : !whenSeen
                      ? "Tell us when you saw this"
                      : !sel
                        ? "Select an incident type above"
                        : `Report ${selItem?.label}`}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* CrosshairPickerModal lives in index.tsx (drive screen root) to avoid
            nested-Modal iOS presentation failures and two-concurrent-MapView
            crashes. onOpenMapPicker() is called above to request it. */}
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

  speedSection: {
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 16,
  },
  speedSectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10,
  },
  speedLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  speedOptional: { fontSize: 11, fontFamily: "Inter_400Regular" },
  speedChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  speedChip: {
    borderWidth: 1.5, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    minWidth: 56, alignItems: "center",
  },
  speedChipTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },

  whenSeenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  whenSeenEmoji: { fontSize: 16 },
  whenSeenLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  communityTipNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  pinPrompt: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, paddingVertical: 20, paddingHorizontal: 16,
    marginTop: 8,
  },
  pinPromptTxt: { fontSize: 13.5, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 20 },

  chipEmoji: { fontSize: 17, lineHeight: 22, fontFamily: EMOJI_FONT_FAMILY },
  submitEmoji: { fontSize: 16, lineHeight: 20, fontFamily: EMOJI_FONT_FAMILY },

  changeTypeRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 20, marginBottom: 14,
  },
  changeTypeTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  cameraCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 2, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  cameraCardIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  cameraCardEmoji: { fontSize: 24, lineHeight: 28, fontFamily: EMOJI_FONT_FAMILY },
  cameraCardLabel: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cameraCardHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 14 },
  submitBtn: {
    paddingVertical: 15, borderRadius: 14,
    alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
  },
  submitTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
