import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { format } from "date-fns";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/utils/apiClient";
import { useColors } from "@/hooks/useColors";

interface AccidentRecord {
  id: string;
  status: "draft" | "complete";
  isManual: boolean;
  detectedAt: string;
  roadName?: string | null;
  county?: string | null;
  speedBeforeKmh?: number | null;
  directionLabel?: string | null;
  photoCount: number;
  witnessCount: number;
  pdfUrl?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "In progress",
  complete: "Report ready",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "#FF9500",
  complete: "#34C759",
};

export default function CrashVaultScreen() {
  const { deviceId } = useApp();
  const colors = useColors();
  const [records, setRecords] = useState<AccidentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!deviceId) return;
    try {
      const data = await apiGet(`/accidents?deviceId=${deviceId}`) as { records: AccidentRecord[] };
      setRecords(data.records ?? []);
    } catch {
      // silently fail — empty state is shown
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const handleNew = useCallback(async () => {
    if (!deviceId) return;
    try {
      const data = await apiPost("/accidents", { deviceId, isManual: true }) as { id: string };
      router.push(`/crash-assistant/${data.id}`);
    } catch {
      // ignore
    }
  }, [deviceId]);

  const styles = makeStyles(colors);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Crash Vault</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Crash Vault</Text>
        <TouchableOpacity onPress={handleNew} style={styles.newBtn}>
          <Ionicons name="add" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {records.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          <View style={styles.emptyIconWrap}>
            <Ionicons name="shield-checkmark-outline" size={52} color={colors.mutedForeground} />
          </View>
          <Text style={styles.emptyTitle}>No accident records</Text>
          <Text style={styles.emptySubtitle}>
            Crash Assistant automatically creates a record when an accident is detected.
            You can also start one manually.
          </Text>
          <TouchableOpacity style={[styles.newReportBtn, { backgroundColor: colors.primary }]} onPress={handleNew}>
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
            <Text style={styles.newReportBtnText}>Start New Report</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <TouchableOpacity style={[styles.newReportBtn, { backgroundColor: colors.primary, marginBottom: 12 }]} onPress={handleNew}>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.newReportBtnText}>Start New Report</Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/crash-assistant/${item.id}`)}
              activeOpacity={0.75}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                  <Ionicons
                    name={item.isManual ? "document-text-outline" : "warning-outline"}
                    size={22}
                    color={item.isManual ? colors.primary : "#FF3B30"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardDate, { color: colors.text }]}>
                    {format(new Date(item.detectedAt), "d MMM yyyy · h:mm a")}
                  </Text>
                  <Text style={[styles.cardLocation, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.roadName ?? "Location not recorded"}
                    {item.county ? ` · ${item.county}` : ""}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[item.status] + "20" }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
              </View>

              <View style={styles.cardMeta}>
                {item.speedBeforeKmh != null && (
                  <View style={styles.metaChip}>
                    <Ionicons name="speedometer-outline" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{Math.round(Number(item.speedBeforeKmh))} km/h</Text>
                  </View>
                )}
                {item.photoCount > 0 && (
                  <View style={styles.metaChip}>
                    <Ionicons name="images-outline" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.photoCount} photos</Text>
                  </View>
                )}
                {item.witnessCount > 0 && (
                  <View style={styles.metaChip}>
                    <Ionicons name="people-outline" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.witnessCount} witnesses</Text>
                  </View>
                )}
                {item.pdfUrl && (
                  <View style={styles.metaChip}>
                    <Ionicons name="document-outline" size={13} color="#34C759" />
                    <Text style={[styles.metaText, { color: "#34C759" }]}>PDF ready</Text>
                  </View>
                )}
              </View>

              <View style={styles.cardArrow}>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backBtn: { width: 40, alignItems: "flex-start" },
    title: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", color: colors.text, textAlign: "center" },
    newBtn: { width: 40, alignItems: "flex-end" },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
    emptyIconWrap: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: colors.muted + "18",
      alignItems: "center", justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: colors.text, marginBottom: 8 },
    emptySubtitle: {
      fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground,
      textAlign: "center", lineHeight: 22, marginBottom: 28,
    },
    newReportBtn: {
      flexDirection: "row", alignItems: "center", gap: 8,
      paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14,
    },
    newReportBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
    list: { padding: 16, gap: 12 },
    card: {
      borderRadius: 16, borderWidth: 1, padding: 16,
      shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
    cardIcon: {
      width: 40, height: 40, borderRadius: 12,
      backgroundColor: colors.muted + "15",
      alignItems: "center", justifyContent: "center",
    },
    cardDate: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
    cardLocation: { fontSize: 13, fontFamily: "Inter_400Regular" },
    statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
    metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
    cardArrow: { position: "absolute", right: 16, top: "50%", marginTop: -8 },
  });
}
