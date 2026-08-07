/**
 * PlaceSearchSheet — "Where to?" free-text place search.
 *
 * Replaces the category-only RouteSearchSheet as the primary destination picker
 * accessed from the "Where to?" bar on the map tab.
 *
 * Flow:
 *  1. User types a place name / address.
 *  2. After 400 ms of no typing we fire nominatimSearch (Google Places → Photon).
 *  3. Results rendered as a scrollable list; tapping one closes the sheet and
 *     calls onSelect so the caller can set it as the nav destination.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { nominatimSearch, GeoResult } from "@/utils/geocoding";

// ── Saved-place quick-access ──────────────────────────────────────────────────

interface QuickPlace {
  icon: "home-outline" | "briefcase-outline" | "star-outline";
  label: string;
  lat: number;
  lng: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (place: { name: string; lat: number; lng: number }) => void;
  savedPlaces?: QuickPlace[];
}

export default function PlaceSearchSheet({ visible, onClose, onSelect, savedPlaces }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<TextInput>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus when sheet opens.
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [visible]);

  // Clear state when sheet closes.
  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setSearched(false);
      setError(null);
      setLoading(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [visible]);

  const runSearch = useCallback(async (text: string) => {
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await nominatimSearch(q);
      setResults(data);
      setSearched(true);
    } catch {
      setError("Search failed. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (text: string) => {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => runSearch(text), 400);
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(null);
    setLoading(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    inputRef.current?.focus();
  };

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  const handleSelect = (place: { name: string; lat: number; lng: number }) => {
    Keyboard.dismiss();
    onSelect(place);
  };

  const isDark = c.isDark;
  const showEmpty = searched && !loading && !error && results.length === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kav}
      >
        <View style={[styles.sheet, {
          backgroundColor: c.card,
          paddingBottom: insets.bottom + 12,
        }]}>
          {/* Grabber */}
          <View style={[styles.grabber, { backgroundColor: c.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Ionicons name="navigate-circle-outline" size={22} color={c.primary} />
            <Text style={[styles.headerTitle, { color: c.foreground }]}>Where to?</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={[styles.inputRow, {
            backgroundColor: isDark ? "#FFFFFF0F" : "#00000009",
            borderColor: c.border,
          }]}>
            <Ionicons name="search-outline" size={18} color={c.mutedForeground} />
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: c.foreground }]}
              placeholder="Search for a place, address…"
              placeholderTextColor={c.mutedForeground}
              value={query}
              onChangeText={handleChange}
              onSubmitEditing={() => runSearch(query)}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="words"
              clearButtonMode="never"
            />
            {loading ? (
              <ActivityIndicator size="small" color={c.primary} style={{ marginRight: 4 }} />
            ) : query.length > 0 ? (
              <TouchableOpacity onPress={handleClear} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={c.mutedForeground} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Saved places / quick access — shown when no query yet */}
          {!query && savedPlaces && savedPlaces.length > 0 && (
            <View style={styles.quickSection}>
              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>SAVED PLACES</Text>
              {savedPlaces.map((sp, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.quickRow, { borderColor: c.border }]}
                  onPress={() => handleSelect({ name: sp.label, lat: sp.lat, lng: sp.lng })}
                  activeOpacity={0.75}
                >
                  <View style={[styles.quickIcon, { backgroundColor: c.primary + "18" }]}>
                    <Ionicons name={sp.icon} size={18} color={c.primary} />
                  </View>
                  <Text style={[styles.quickLabel, { color: c.foreground }]}>{sp.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Prompt — before any search */}
          {!query && (!savedPlaces || savedPlaces.length === 0) && (
            <View style={styles.emptyState}>
              <Ionicons name="map-outline" size={32} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                Type a destination to get started
              </Text>
            </View>
          )}

          {/* Error */}
          {error && !loading && (
            <View style={styles.emptyState}>
              <Ionicons name="cloud-offline-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>{error}</Text>
            </View>
          )}

          {/* Empty results */}
          {showEmpty && (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={28} color={c.mutedForeground} />
              <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>
                No places found for "{query}". Try a different name.
              </Text>
            </View>
          )}

          {/* Results */}
          {results.length > 0 && (
            <FlatList
              data={results}
              keyExtractor={(_, i) => String(i)}
              style={styles.list}
              contentContainerStyle={{ paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.resultRow, { borderColor: c.border }]}
                  activeOpacity={0.72}
                  onPress={() => handleSelect({ name: item.short, lat: item.lat, lng: item.lng })}
                >
                  <View style={[styles.resultIcon, { backgroundColor: c.primary + "15" }]}>
                    <Ionicons name="location-outline" size={18} color={c.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.resultName, { color: c.foreground }]}
                      numberOfLines={1}
                    >
                      {item.short}
                    </Text>
                    {item.display !== item.short && (
                      <Text
                        style={[styles.resultAddr, { color: c.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {item.display}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="navigate-outline" size={16} color={c.primary} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000055" },
  kav: { justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    maxHeight: "88%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 22,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    gap: 10,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  quickSection: { marginBottom: 8 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  quickLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  emptyState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 40,
  },
  emptyTxt: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  list: { marginTop: 2 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  resultName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  resultAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
