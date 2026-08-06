/**
 * dashcam-clips.tsx — Gallery of local dashcam segments and uploaded locked clips.
 *
 * Shows local segments (all) plus server-backed uploaded clips fetched from
 * /api/dashcam/clips.  Local-only segments show upload status badges; uploaded
 * segments allow sharing and server-side deletion.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useDashcam, type DashcamSegment } from "@/context/DashcamContext";
import { FLAT_LIST_PROPS } from "@/lib/scrollProps";
import { API_BASE } from "@/utils/apiClient";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SECRET_KEY = "dashcam_secret_v1";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ServerClip {
  id: string;
  fileKey: string;
  durationS: number | null;
  sizeBytes: number | null;
  lockReason: string | null;
  startedAt: string;   // ISO
  uploadedAt: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  const d   = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getDate()} ${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

function fmtSize(b: number | null | undefined): string {
  if (!b) return "—";
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

const UPLOAD_LABELS: Record<DashcamSegment["uploadStatus"], string> = {
  none:      "",
  pending:   "Queued",
  uploading: "Uploading…",
  uploaded:  "Backed up",
  failed:    "Upload failed",
};

const UPLOAD_COLORS: Record<DashcamSegment["uploadStatus"], string> = {
  none:      "",
  pending:   "#FF9500",
  uploading: "#007AFF",
  uploaded:  "#34C759",
  failed:    "#FF3B30",
};

// ─── Segment row ─────────────────────────────────────────────────────────────

function SegmentRow({
  seg,
  onDelete,
  onShare,
}: {
  seg: DashcamSegment;
  onDelete: (id: string) => void;
  onShare: (seg: DashcamSegment) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: seg.locked ? "#1976D218" : c.muted }]}>
        <Ionicons
          name={seg.locked ? "lock-closed" : "videocam-outline"}
          size={20}
          color={seg.locked ? "#1976D2" : c.mutedForeground}
        />
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.dateText, { color: c.foreground }]}>
          {fmtDate(seg.startedAt)}
        </Text>
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>
          {fmtDuration(seg.durationS)}  ·  {fmtSize(seg.sizeBytes)}
          {seg.locked && seg.lockReason ? `  ·  ${seg.lockReason === "manual" ? "Locked" : seg.lockReason}` : ""}
        </Text>
        {seg.uploadStatus !== "none" && (
          <View style={styles.uploadRow}>
            {seg.uploadStatus === "uploading" && (
              <View style={[styles.uploadDot, { backgroundColor: "#007AFF" }]} />
            )}
            <Text style={[styles.uploadText, { color: UPLOAD_COLORS[seg.uploadStatus] }]}>
              {UPLOAD_LABELS[seg.uploadStatus]}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: c.muted }]}
          onPress={() => onShare(seg)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="share-outline" size={16} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#FF3B3014" }]}
          onPress={() => onDelete(seg.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Server-clip row (for uploaded clips not yet in local list) ───────────────

function ServerClipRow({
  clip,
  onDelete,
  onGetUrl,
}: {
  clip: ServerClip;
  onDelete: (id: string) => void;
  onGetUrl: (id: string) => void;
}) {
  const c = useColors();
  const startMs = new Date(clip.startedAt).getTime();
  return (
    <View style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: "#1976D218" }]}>
        <Ionicons name="cloud-done-outline" size={20} color="#1976D2" />
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.dateText, { color: c.foreground }]}>
          {fmtDate(startMs)}
        </Text>
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>
          {fmtDuration(clip.durationS)}  ·  {fmtSize(clip.sizeBytes)}
          {clip.lockReason ? `  ·  ${clip.lockReason === "manual" ? "Locked" : clip.lockReason}` : ""}
        </Text>
        <Text style={[styles.uploadText, { color: "#34C759" }]}>Backed up (cloud)</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: c.muted }]}
          onPress={() => onGetUrl(clip.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="share-outline" size={16} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#FF3B3014" }]}
          onPress={() => onDelete(clip.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DashcamClipsScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const {
    segments, deleteSegment, clearUnlocked, storageUsedBytes,
    isRecording, openDashcam, pushDeviceId,
  } = useDashcam();
  // pushDeviceId comes from DashcamContext (AsyncStorage "@msafiri/deviceId"),
  // which matches what push_tokens stores. Never use AppContext.deviceId here.

  // Server-backed clips (uploaded clips fetched from API)
  const [serverClips, setServerClips]     = useState<ServerClip[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  const topInset    = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  // ── Fetch server clips ────────────────────────────────────────────────────
  const fetchServerClips = useCallback(async () => {
    if (!pushDeviceId || !API_BASE) return;
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret) return;
      setServerLoading(true);
      const res = await fetch(`${API_BASE}/dashcam/clips`, {
        headers: {
          "X-Device-Id":      pushDeviceId,
          "X-Dashcam-Secret": secret,
        },
      });
      if (!res.ok) return;
      const { clips } = (await res.json()) as { clips: ServerClip[] };
      // Filter out clips already tracked locally (by serverId)
      const localServerIds = new Set(segments.map((s) => s.serverId).filter(Boolean));
      setServerClips(clips.filter((c) => !localServerIds.has(c.id)));
    } catch (err) {
      console.warn("[DashcamClips] server fetch failed:", err);
    } finally {
      setServerLoading(false);
    }
  }, [pushDeviceId, segments]);

  useEffect(() => {
    fetchServerClips();
  }, [fetchServerClips]);

  // ── Delete handlers ───────────────────────────────────────────────────────

  const handleDeleteLocal = (id: string) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    Alert.alert(
      "Delete clip?",
      seg.locked
        ? "This is a locked clip. It will be deleted from your device and from cloud storage."
        : "This clip will be permanently deleted from your device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await deleteSegment(id);
          },
        },
      ]
    );
  };

  const handleDeleteServer = async (clipId: string) => {
    Alert.alert(
      "Delete cloud clip?",
      "This clip will be permanently deleted from cloud storage and cannot be recovered.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const secret = await AsyncStorage.getItem(SECRET_KEY);
              if (!secret || !pushDeviceId) return;
              const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}`, {
                method: "DELETE",
                headers: {
                  "X-Device-Id":      pushDeviceId,
                  "X-Dashcam-Secret": secret,
                },
              });
              if (res.ok) {
                setServerClips((prev) => prev.filter((c) => c.id !== clipId));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else {
                Alert.alert("Error", "Could not delete clip. Try again.");
              }
            } catch (err) {
              Alert.alert("Error", "Network error — check your connection.");
            }
          },
        },
      ]
    );
  };

  const handleShareLocal = (seg: DashcamSegment) => {
    Share.share({
      message: `Msafiri dashcam clip — ${fmtDate(seg.startedAt)}`,
      url: Platform.OS === "ios" ? seg.uri : undefined,
    }).catch(() => {});
  };

  const handleShareServer = async (clipId: string) => {
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret || !pushDeviceId) return;
      const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}/url`, {
        headers: {
          "X-Device-Id":      pushDeviceId,
          "X-Dashcam-Secret": secret,
        },
      });
      if (!res.ok) { Alert.alert("Error", "Could not get share link."); return; }
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      Share.share({ message: "Msafiri dashcam clip", url: downloadUrl }).catch(() => {});
    } catch {
      Alert.alert("Error", "Network error — check your connection.");
    }
  };

  const handleClearUnlocked = () => {
    const count = segments.filter((s) => !s.locked).length;
    if (count === 0) return;
    Alert.alert(
      "Clear all loop recordings?",
      `This will delete ${count} unlocked segment${count === 1 ? "" : "s"} from your device. Locked clips are kept.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            await clearUnlocked();
            setDeleting(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const sortedSegments   = [...segments].sort((a, b) => b.startedAt - a.startedAt);
  const unlockedCount    = segments.filter((s) => !s.locked).length;
  const lockedCount      = segments.filter((s) => s.locked).length;
  const cloudOnlyCount   = serverClips.length;  // uploaded clips not in local list

  return (
    <FlatList
      {...FLAT_LIST_PROPS}
      data={sortedSegments}
      keyExtractor={(item) => item.id}
      style={{ backgroundColor: c.background }}
      contentContainerStyle={{
        paddingTop:    topInset + 12,
        paddingBottom: bottomInset + 40,
        paddingHorizontal: 16,
        gap: 8,
      }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={26} color={c.foreground} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: c.foreground }]}>Dashcam Clips</Text>
            <TouchableOpacity
              onPress={fetchServerClips}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="refresh" size={22} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Stats */}
          <View style={[styles.statsCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: c.foreground }]}>{lockedCount}</Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Locked</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: c.foreground }]}>{unlockedCount}</Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Loop</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: c.foreground }]}>{cloudOnlyCount}</Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Cloud only</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNum, { color: c.foreground }]}>
                {(storageUsedBytes / 1_048_576).toFixed(0)} MB
              </Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>Used</Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.openBtn, { backgroundColor: c.primary }]}
              onPress={() => { openDashcam(); router.back(); }}
            >
              <Ionicons name="videocam" size={16} color="#fff" />
              <Text style={[styles.openBtnText, { color: "#fff" }]}>
                {isRecording ? "Return to dashcam" : "Open Dashcam"}
              </Text>
            </TouchableOpacity>

            {unlockedCount > 0 && (
              <TouchableOpacity
                style={[styles.clearBtn, { borderColor: c.border }]}
                onPress={handleClearUnlocked}
                disabled={deleting}
              >
                <Ionicons name="trash-outline" size={15} color="#FF3B30" />
                <Text style={styles.clearBtnText}>Clear loop recordings</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Cloud-only clips (uploaded but not in local list) */}
          {cloudOnlyCount > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>CLOUD CLIPS</Text>
              {serverClips.map((clip) => (
                <ServerClipRow
                  key={clip.id}
                  clip={clip}
                  onDelete={handleDeleteServer}
                  onGetUrl={handleShareServer}
                />
              ))}
            </>
          )}

          {sortedSegments.length > 0 && (
            <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>
              {cloudOnlyCount > 0 ? "LOCAL CLIPS" : "ALL CLIPS"}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <SegmentRow
          seg={item}
          onDelete={handleDeleteLocal}
          onShare={handleShareLocal}
        />
      )}
      ListEmptyComponent={
        cloudOnlyCount === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="videocam-outline" size={48} color={c.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: c.foreground }]}>No clips yet</Text>
            <Text style={[styles.emptyBody, { color: c.mutedForeground }]}>
              Start the dashcam and recordings will appear here. Tap Lock Clip to save permanently.
            </Text>
          </View>
        ) : null
      }
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  statsCard: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    gap: 3,
  },
  statNum: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  statDivider: { width: 1 },
  btnRow:     { gap: 10 },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  openBtnText: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  clearBtnText: {
    color: "#FF3B30",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  dateText: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  uploadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  uploadText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  emptyBody: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
});
