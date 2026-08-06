/**
 * dashcam-clips.tsx — Gallery of local dashcam segments and uploaded locked clips.
 *
 * Shows local segments (all) plus server-backed uploaded clips fetched from
 * /api/dashcam/clips.  Tapping the play button on any clip opens the full-screen
 * VideoPlayerModal for in-app review before exporting.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
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

interface PlayerConfig {
  uri: string;
  title: string;
  onShare?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  const d   = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getDate()} ${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtShortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString("default", { month: "short" })}, ${d.getFullYear()}`;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  if (s < 60) return `${s}s`;
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

function fmtTime(s: number): string {
  if (!s || isNaN(s) || s < 0) return "0:00";
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
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

const SPEEDS = [0.5, 1, 1.5, 2];

// ─── Video Player Modal ───────────────────────────────────────────────────────

function VideoPlayerModal({ config, onClose }: { config: PlayerConfig; onClose: () => void }) {
  const insets    = useSafeAreaInsets();
  const player    = useVideoPlayer(config.uri, (p) => { p.loop = false; p.play(); });

  const [isPlaying,       setIsPlaying]       = useState(true);
  const [currentTime,     setCurrentTime]     = useState(0);
  const [duration,        setDuration]        = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speedIdx,        setSpeedIdx]        = useState(1);  // default 1×
  const [barWidth,        setBarWidth]        = useState(1);

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsAnim  = useRef(new Animated.Value(1)).current;

  // ── Poll playback state ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const ct = player.currentTime;
        const d  = player.duration;
        setCurrentTime(isNaN(ct) ? 0 : ct);
        if (d && !isNaN(d) && d > 0) setDuration(d);
        setIsPlaying(player.playing);
      } catch { /* player may not be ready yet */ }
    }, 250);
    return () => clearInterval(id);
  }, [player]);

  // ── Controls auto-hide ────────────────────────────────────────────────────
  const showControls = useCallback(() => {
    setControlsVisible(true);
    Animated.timing(controlsAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      Animated.timing(controlsAnim, { toValue: 0, duration: 400, useNativeDriver: true })
        .start(() => setControlsVisible(false));
    }, 4000);
  }, [controlsAnim]);

  useEffect(() => {
    showControls();
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [showControls]);

  const handleTap = () => {
    if (controlsVisible) {
      Animated.timing(controlsAnim, { toValue: 0, duration: 200, useNativeDriver: true })
        .start(() => setControlsVisible(false));
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    } else {
      showControls();
    }
  };

  // ── Playback controls ─────────────────────────────────────────────────────
  const togglePlay = () => {
    if (player.playing) player.pause();
    else player.play();
    showControls();
  };

  const seekBy = (secs: number) => {
    const next = Math.max(0, Math.min(duration, currentTime + secs));
    player.currentTime = next;
    showControls();
  };

  const seekToRatio = (ratio: number) => {
    player.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
    showControls();
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    player.playbackRate = SPEEDS[next];
    showControls();
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={player_s.root}>

        {/* Video */}
        <VideoView
          player={player as any}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
        />

        {/* Tap-to-toggle controls */}
        <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} />

        {/* Top bar */}
        <Animated.View
          style={[player_s.topBar, { paddingTop: insets.top + 8, opacity: controlsAnim }]}
          pointerEvents={controlsVisible ? "box-none" : "none"}
        >
          <TouchableOpacity onPress={onClose} style={player_s.topBtn} activeOpacity={0.75}>
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={player_s.topTitle} numberOfLines={1}>{config.title}</Text>
          {config.onShare ? (
            <TouchableOpacity onPress={config.onShare} style={player_s.topBtn} activeOpacity={0.75}>
              <Ionicons name="share-outline" size={22} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={player_s.topBtn} />
          )}
        </Animated.View>

        {/* Bottom controls */}
        <Animated.View
          style={[{ opacity: controlsAnim }]}
          pointerEvents={controlsVisible ? "box-none" : "none"}
        >
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.92)"]} style={[player_s.bottomGrad, { paddingBottom: insets.bottom + 20 }]}>

            {/* Seek bar */}
            <View
              style={player_s.seekContainer}
              onLayout={(e) => setBarWidth(Math.max(1, e.nativeEvent.layout.width))}
            >
              <Pressable
                style={player_s.seekPressable}
                onPress={(e) => seekToRatio(e.nativeEvent.locationX / barWidth)}
              >
                <View style={player_s.seekBg}>
                  <View style={[player_s.seekFill, { width: `${progress * 100}%` as any }]} />
                </View>
                {/* Thumb dot */}
                <View style={[player_s.seekThumb, { left: progress * (barWidth - 12) }]} />
              </Pressable>
              <View style={player_s.timeRow}>
                <Text style={player_s.timeText}>{fmtTime(currentTime)}</Text>
                <Text style={player_s.timeText}>{fmtTime(duration)}</Text>
              </View>
            </View>

            {/* Buttons */}
            <View style={player_s.btnRow}>
              {/* Speed */}
              <TouchableOpacity onPress={cycleSpeed} style={player_s.speedBtn} activeOpacity={0.7}>
                <Text style={player_s.speedText}>{SPEEDS[speedIdx]}×</Text>
              </TouchableOpacity>

              {/* Skip back 15 */}
              <TouchableOpacity onPress={() => seekBy(-15)} style={player_s.skipBtn} activeOpacity={0.7}>
                <Ionicons name="play-back-outline" size={28} color="#fff" />
                <Text style={player_s.skipLabel}>15</Text>
              </TouchableOpacity>

              {/* Play / Pause */}
              <TouchableOpacity onPress={togglePlay} style={player_s.playBtn} activeOpacity={0.85}>
                <Ionicons name={isPlaying ? "pause" : "play"} size={28} color="#000" />
              </TouchableOpacity>

              {/* Skip forward 15 */}
              <TouchableOpacity onPress={() => seekBy(15)} style={player_s.skipBtn} activeOpacity={0.7}>
                <Ionicons name="play-forward-outline" size={28} color="#fff" />
                <Text style={player_s.skipLabel}>15</Text>
              </TouchableOpacity>

              {/* Spacer matching speed btn */}
              <View style={player_s.speedBtn} />
            </View>

          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Segment row ─────────────────────────────────────────────────────────────

function SegmentRow({
  seg,
  onDelete,
  onShare,
  onPlay,
}: {
  seg: DashcamSegment;
  onDelete: (id: string) => void;
  onShare: (seg: DashcamSegment) => void;
  onPlay: (seg: DashcamSegment) => void;
}) {
  const c = useColors();
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => onPlay(seg)}
      activeOpacity={0.85}
    >
      {/* Play thumbnail */}
      <View style={styles.thumbWrap}>
        <View style={[styles.thumbBg, { backgroundColor: seg.locked ? "#1976D218" : c.muted }]}>
          <Ionicons name="play" size={20} color={seg.locked ? "#1976D2" : c.mutedForeground} />
        </View>
        {seg.locked && (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={9} color="#fff" />
          </View>
        )}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.dateText, { color: c.foreground }]}>{fmtDate(seg.startedAt)}</Text>
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
          onPress={(e) => { e.stopPropagation?.(); onShare(seg); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="share-outline" size={16} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#FF3B3014" }]}
          onPress={(e) => { e.stopPropagation?.(); onDelete(seg.id); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Server-clip row ──────────────────────────────────────────────────────────

function ServerClipRow({
  clip,
  loading,
  onDelete,
  onShare,
  onPlay,
}: {
  clip: ServerClip;
  loading: boolean;
  onDelete: (id: string) => void;
  onShare: (id: string) => void;
  onPlay: (id: string) => void;
}) {
  const c       = useColors();
  const startMs = new Date(clip.startedAt).getTime();
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => onPlay(clip.id)}
      activeOpacity={0.85}
      disabled={loading}
    >
      <View style={styles.thumbWrap}>
        <View style={[styles.thumbBg, { backgroundColor: "#1976D218" }]}>
          {loading
            ? <Ionicons name="cloud-download-outline" size={18} color="#1976D2" />
            : <Ionicons name="play" size={20} color="#1976D2" />
          }
        </View>
        <View style={[styles.lockBadge, { backgroundColor: "#1976D2" }]}>
          <Ionicons name="cloud-outline" size={9} color="#fff" />
        </View>
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.dateText, { color: c.foreground }]}>{fmtDate(startMs)}</Text>
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>
          {fmtDuration(clip.durationS)}  ·  {fmtSize(clip.sizeBytes)}
          {clip.lockReason ? `  ·  ${clip.lockReason === "manual" ? "Locked" : clip.lockReason}` : ""}
        </Text>
        <Text style={[styles.uploadText, { color: "#34C759" }]}>
          {loading ? "Loading…" : "Backed up (cloud)"}
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: c.muted }]}
          onPress={(e) => { e.stopPropagation?.(); onShare(clip.id); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={loading}
        >
          <Ionicons name="share-outline" size={16} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: "#FF3B3014" }]}
          onPress={(e) => { e.stopPropagation?.(); onDelete(clip.id); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={loading}
        >
          <Ionicons name="trash-outline" size={16} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
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

  const [serverClips, setServerClips]     = useState<ServerClip[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [loadingClipId, setLoadingClipId] = useState<string | null>(null);
  const [deleting, setDeleting]           = useState(false);
  const [playerConfig, setPlayerConfig]   = useState<PlayerConfig | null>(null);

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
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) return;
      const { clips } = (await res.json()) as { clips: ServerClip[] };
      const localServerIds = new Set(segments.map((s) => s.serverId).filter(Boolean));
      setServerClips(clips.filter((c) => !localServerIds.has(c.id)));
    } catch (err) {
      console.warn("[DashcamClips] server fetch failed:", err);
    } finally {
      setServerLoading(false);
    }
  }, [pushDeviceId, segments]);

  useEffect(() => { fetchServerClips(); }, [fetchServerClips]);

  // ── Play handlers ─────────────────────────────────────────────────────────

  const handlePlayLocal = (seg: DashcamSegment) => {
    Haptics.selectionAsync();
    setPlayerConfig({
      uri:   seg.uri,
      title: fmtShortDate(seg.startedAt),
      onShare: () => handleShareLocal(seg),
    });
  };

  const handlePlayServer = async (clipId: string) => {
    if (loadingClipId) return;
    Haptics.selectionAsync();
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret || !pushDeviceId) return;
      setLoadingClipId(clipId);
      const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}/url`, {
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) { Alert.alert("Error", "Could not load video. Try again."); return; }
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      const clip = serverClips.find((c) => c.id === clipId);
      setPlayerConfig({
        uri:   downloadUrl,
        title: clip ? fmtShortDate(new Date(clip.startedAt).getTime()) : "Clip",
        onShare: () => Share.share({ message: "Msafiri dashcam clip", url: downloadUrl }).catch(() => {}),
      });
    } catch {
      Alert.alert("Error", "Network error — check your connection.");
    } finally {
      setLoadingClipId(null);
    }
  };

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
        { text: "Delete", style: "destructive", onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await deleteSegment(id);
        }},
      ]
    );
  };

  const handleDeleteServer = async (clipId: string) => {
    Alert.alert(
      "Delete cloud clip?",
      "This clip will be permanently deleted from cloud storage and cannot be recovered.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
            try {
              const secret = await AsyncStorage.getItem(SECRET_KEY);
              if (!secret || !pushDeviceId) return;
              const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}`, {
                method: "DELETE",
                headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
              });
              if (res.ok) {
                setServerClips((prev) => prev.filter((c) => c.id !== clipId));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else {
                Alert.alert("Error", "Could not delete clip. Try again.");
              }
            } catch { Alert.alert("Error", "Network error — check your connection."); }
        }},
      ]
    );
  };

  // ── Share handlers ────────────────────────────────────────────────────────

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
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) { Alert.alert("Error", "Could not get share link."); return; }
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      Share.share({ message: "Msafiri dashcam clip", url: downloadUrl }).catch(() => {});
    } catch { Alert.alert("Error", "Network error — check your connection."); }
  };

  const handleClearUnlocked = () => {
    const count = segments.filter((s) => !s.locked).length;
    if (count === 0) return;
    Alert.alert(
      "Clear all loop recordings?",
      `This will delete ${count} unlocked segment${count === 1 ? "" : "s"} from your device. Locked clips are kept.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: async () => {
            setDeleting(true);
            await clearUnlocked();
            setDeleting(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }},
      ]
    );
  };

  const sortedSegments = [...segments].sort((a, b) => b.startedAt - a.startedAt);
  const unlockedCount  = segments.filter((s) => !s.locked).length;
  const lockedCount    = segments.filter((s) => s.locked).length;
  const cloudOnlyCount = serverClips.length;

  return (
    <>
      <FlatList
        {...FLAT_LIST_PROPS}
        data={sortedSegments}
        keyExtractor={(item) => item.id}
        style={{ backgroundColor: c.background }}
        contentContainerStyle={{
          paddingTop: topInset + 12,
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
                <Ionicons name="refresh" size={22} color={serverLoading ? c.primary : c.mutedForeground} />
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

            {/* Hint */}
            <View style={[styles.playHint, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="play-circle-outline" size={16} color={c.primary} />
              <Text style={[styles.playHintText, { color: c.mutedForeground }]}>
                Tap any clip to preview it before exporting
              </Text>
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

            {/* Cloud-only clips */}
            {cloudOnlyCount > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>CLOUD CLIPS</Text>
                {serverClips.map((clip) => (
                  <ServerClipRow
                    key={clip.id}
                    clip={clip}
                    loading={loadingClipId === clip.id}
                    onDelete={handleDeleteServer}
                    onShare={handleShareServer}
                    onPlay={handlePlayServer}
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
            onPlay={handlePlayLocal}
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

      {/* Full-screen video player */}
      {playerConfig && (
        <VideoPlayerModal
          config={playerConfig}
          onClose={() => setPlayerConfig(null)}
        />
      )}
    </>
  );
}

// ─── Video player styles ──────────────────────────────────────────────────────

const player_s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: "#000" },

  // Top bar
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 12,
    background: "transparent",
  } as any,
  topBtn:   { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: {
    flex: 1, color: "#fff", fontSize: 16, fontWeight: "600",
    textAlign: "center",
    // @ts-ignore
    fontFamily: "Inter_600SemiBold",
  },

  // Bottom gradient
  bottomGrad: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingTop: 60, paddingHorizontal: 20,
  },

  // Seek bar
  seekContainer: { marginBottom: 16 },
  seekPressable: { height: 20, justifyContent: "center" },
  seekBg: {
    height: 3, backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 1.5, overflow: "hidden",
  },
  seekFill: {
    position: "absolute", top: 0, left: 0, height: "100%" as any,
    backgroundColor: "#FF3B30", borderRadius: 1.5,
  },
  seekThumb: {
    position: "absolute", top: "50%" as any,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: "#fff",
    marginTop: -6,
  },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  timeText: {
    color: "rgba(255,255,255,0.7)", fontSize: 12,
    // @ts-ignore
    fontVariant: ["tabular-nums"],
    fontFamily: "Inter_400Regular",
  },

  // Control buttons row
  btnRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  speedBtn: {
    width: 52, height: 44, alignItems: "center", justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  speedText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  skipBtn: {
    width: 60, height: 60, alignItems: "center", justifyContent: "center", gap: 0,
  },
  skipLabel: {
    position: "absolute", bottom: 6,
    color: "#fff", fontSize: 10, fontWeight: "700",
  },
  playBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
});

// ─── List styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 4,
  },
  title: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  statsCard: {
    flexDirection: "row", borderRadius: 14, borderWidth: 1, overflow: "hidden",
  },
  statItem:    { flex: 1, alignItems: "center", paddingVertical: 14, gap: 3 },
  statNum:     { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  statLabel:   { fontSize: 11, fontWeight: "500", fontFamily: "Inter_500Medium" },
  statDivider: { width: 1 },

  playHint: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10, borderRadius: 10, borderWidth: 1,
  },
  playHintText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  btnRow:  { gap: 10 },
  openBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  openBtnText: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  clearBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 1,
  },
  clearBtnText: {
    color: "#FF3B30", fontSize: 14, fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  sectionLabel: {
    fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8, marginTop: 4,
  },

  // Clip row
  row: {
    flexDirection: "row", alignItems: "center",
    gap: 12, borderRadius: 14, borderWidth: 1, padding: 14,
  },
  thumbWrap: { position: "relative" },
  thumbBg: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center",
  },
  lockBadge: {
    position: "absolute", bottom: 0, right: 0,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "#FF3B30",
    alignItems: "center", justifyContent: "center",
  },
  dateText:   { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  metaText:   { fontSize: 12, fontFamily: "Inter_400Regular" },
  uploadRow:  { flexDirection: "row", alignItems: "center", gap: 4 },
  uploadDot:  { width: 6, height: 6, borderRadius: 3 },
  uploadText: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  actions:    { flexDirection: "row", gap: 8 },
  actionBtn:  {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },

  // Empty state
  empty: { alignItems: "center", gap: 12, paddingVertical: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  emptyBody: {
    fontSize: 14, textAlign: "center", lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
});
