export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useCallback, useState, useRef, useMemo } from "react";
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
  TextInput, Image, ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { SORTED_MAKES, sortedModels, getCarImageUrl, type CarMake, type CarModel } from "@/data/carModels";

// ─── Step enum ───────────────────────────────────────────────────────────────
type Step = "make" | "model";

// ─── CarImage — thumbnail with fallback emoji ─────────────────────────────────
function CarImage({ makeId, modelId, emoji, size }: { makeId: string; modelId: string; emoji: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Text style={{ fontSize: size * 0.6, lineHeight: size }}>{emoji}</Text>;
  }
  return (
    <Image
      source={{ uri: getCarImageUrl(makeId, modelId) }}
      style={{ width: size, height: size * 0.65 }}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

export default function CarPickerScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { vehicleMakeId, vehicleModelId, setVehicleModel } = useApp();

  const [step, setStep] = useState<Step>("make");
  const [selectedMake, setSelectedMake] = useState<CarMake | null>(null);
  const [query, setQuery] = useState("");

  // ── Makes list ────────────────────────────────────────────────────────────
  const filteredMakes = useMemo(() =>
    query.trim()
      ? SORTED_MAKES.filter(m => m.name.toLowerCase().includes(query.toLowerCase()))
      : SORTED_MAKES,
    [query]
  );

  // ── Models list ───────────────────────────────────────────────────────────
  const filteredModels = useMemo(() => {
    if (!selectedMake) return [];
    const sorted = sortedModels(selectedMake);
    return query.trim()
      ? sorted.filter(m => m.name.toLowerCase().includes(query.toLowerCase()))
      : sorted;
  }, [selectedMake, query]);

  const handleSelectMake = useCallback((make: CarMake) => {
    setSelectedMake(make);
    setQuery("");
    setStep("model");
  }, []);

  const handleSelectModel = useCallback((model: CarModel) => {
    if (!selectedMake) return;
    setVehicleModel(selectedMake.id, model.id);
    router.back();
  }, [selectedMake, setVehicleModel]);

  const handleBack = useCallback(() => {
    if (step === "model") {
      setStep("make");
      setQuery("");
    } else {
      router.back();
    }
  }, [step]);

  // ── Render item ───────────────────────────────────────────────────────────
  const renderMakeItem = useCallback(({ item }: { item: CarMake }) => {
    const isSelected = vehicleMakeId === item.id;
    return (
      <TouchableOpacity
        style={[
          styles.row, { backgroundColor: c.card, borderColor: isSelected ? c.primary : c.tileBorder }
        ]}
        onPress={() => handleSelectMake(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.emojiBox, { backgroundColor: c.muted }]}>
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>
        <Text style={[styles.rowLabel, { color: c.foreground }]}>{item.name}</Text>
        {isSelected && <Ionicons name="checkmark-circle" size={20} color={c.primary} />}
        <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} style={{ marginLeft: isSelected ? 6 : 0 }} />
      </TouchableOpacity>
    );
  }, [c, vehicleMakeId, handleSelectMake]);

  const renderModelItem = useCallback(({ item }: { item: CarModel }) => {
    if (!selectedMake) return null;
    const isSelected = vehicleMakeId === selectedMake.id && vehicleModelId === item.id;
    return (
      <TouchableOpacity
        style={[
          styles.modelRow, { backgroundColor: c.card, borderColor: isSelected ? c.primary : c.tileBorder }
        ]}
        onPress={() => handleSelectModel(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.modelThumb, { backgroundColor: c.muted }]}>
          <CarImage makeId={selectedMake.id} modelId={item.id} emoji={selectedMake.emoji} size={72} />
        </View>
        <Text style={[styles.modelLabel, { color: c.foreground }]}>{item.name}</Text>
        {isSelected && <Ionicons name="checkmark-circle" size={20} color={c.primary} />}
      </TouchableOpacity>
    );
  }, [c, selectedMake, vehicleMakeId, vehicleModelId, handleSelectModel]);

  const headerTitle = step === "make" ? "Select Make" : (selectedMake?.name ?? "Select Model");
  const data: any[] = step === "make" ? filteredMakes : filteredModels;
  const renderItem = step === "make" ? renderMakeItem : renderModelItem;

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.background }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]} numberOfLines={1}>{headerTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: c.muted }]}>
        <Ionicons name="search" size={16} color={c.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: c.foreground }]}
          placeholder={step === "make" ? "Search makes…" : "Search models…"}
          placeholderTextColor={c.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Breadcrumb — show selected make when picking model */}
      {step === "model" && selectedMake && (
        <View style={[styles.breadcrumb, { backgroundColor: c.primary + "16", borderColor: c.primary + "40" }]}>
          <Text style={[styles.breadcrumbTxt, { color: c.primary }]}>
            {selectedMake.emoji}  {selectedMake.name}
          </Text>
          <TouchableOpacity onPress={() => { setStep("make"); setQuery(""); }}>
            <Text style={[styles.changeTxt, { color: c.primary }]}>Change</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={{ alignItems: "center", marginTop: 60 }}>
            <Text style={[styles.emptyTxt, { color: c.mutedForeground }]}>No results for "{query}"</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    margin: 12, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  breadcrumb: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 12, marginBottom: 4, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  breadcrumbTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  changeTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", opacity: 0.8 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14,
  },
  emojiBox: { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 24 },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

  modelRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 14, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 14,
  },
  modelThumb: {
    width: 88, height: 58, borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  modelLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
