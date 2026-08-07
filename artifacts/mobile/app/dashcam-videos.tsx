/**
 * dashcam-videos.tsx — Redesigned dashcam video gallery.
 *
 * Features:
 *  • Vehicle selector (multi-vehicle support)
 *  • Connection status + quick-action buttons
 *  • All Videos / Locked / Downloads tabs with date-range filter chips
 *  • Date-grouped clip list with Photon reverse-geocoded location names
 *  • Full play / share / lock / download / delete per clip
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ActivityIndicator, Alert, Animated, FlatList, Modal, Platform,
  Pressable, ScrollView, Share as RNShare, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useDashcam, type DashcamSegment } from "@/context/DashcamContext";
import { FLAT_LIST_PROPS } from "@/lib/scrollProps";
import { API_BASE } from "@/utils/apiClient";
import { loadVehicles, type SavedVehicle } from "@/utils/savedVehicles";
import { getCarImageUrl, getMakeById, getModelById } from "@/data/carModels";
import { fetchWithTimeout } from "@/utils/fetchTimeout";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerClip {
  id: string;
  fileKey: string;
  durationS: number | null;
  sizeBytes: number | null;
  lockReason: string | null;
  startedAt: string;
  uploadedAt: string | null;
  lat: number | null;
  lng: number | null;
}

interface UnifiedClip {
  id: string;
  uri?: string;
  startedAt: number;   // epoch ms
  durationS: number;
  sizeBytes: number;
  locked: boolean;
  lockReason?: string;
  uploadStatus?: DashcamSegment["uploadStatus"];
  source: "local" | "server";
  serverId?: string;
  lat?: number;
  lng?: number;
}

type Tab        = "all" | "locked" | "downloads";
type DateFilter = "all" | "today" | "yesterday" | "week";

type ListItem =
  | { type: "section"; label: string; count: number; key: string }
  | { type: "clip";    clip: UnifiedClip;            key: string }
  | { type: "empty";   message: string;              key: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET_KEY      = "dashcam_secret_v1";
const LOC_CACHE_KEY   = (id: string) => `dc_loc_v1_${id}`;
const SPEEDS          = [0.5, 1, 1.5, 2];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  const d    = new Date(ms);
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hr   = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr}:${m} ${ampm}`;
}

function fmtDuration(s: number): string {
  if (!s || s < 0) return "0:00";
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function fmtSize(b: number | null | undefined): string {
  if (!b) return "—";
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

function dayLabel(ms: number): string {
  const d       = new Date(ms);
  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const clipDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff    = Math.round((today.getTime() - clipDay.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });
}

function timeOfDayName(ms: number): string {
  const h = new Date(ms).getHours();
  if (h >= 5  && h < 12) return "Morning Recording";
  if (h >= 12 && h < 17) return "Afternoon Recording";
  if (h >= 17 && h < 21) return "Evening Recording";
  return "Night Recording";
}

function inRange(ms: number, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const now   = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0    = today.getTime();
  if (filter === "today")     return ms >= t0;
  if (filter === "yesterday") return ms >= t0 - 86_400_000 && ms < t0;
  if (filter === "week")      return ms >= now - 7 * 86_400_000;
  return true;
}

async function photonReverse(lat: number, lng: number): Promise<string | null> {
  try {
    const res  = await fetchWithTimeout(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`, {}, 8000
    );
    const data = await res.json() as { features?: any[] };
    if (!data.features?.length) return null;
    const p    = data.features[0]?.properties ?? {};
    const name = (p.name ?? p.street) as string | undefined;
    const area = (p.city ?? p.district ?? p.county) as string | undefined;
    const raw  = [name, area].filter(Boolean).join(", ");
    return raw.substring(0, 60) || null;
  } catch {
    return null;
  }
}

function syncLabel(d: Date | null): string {
  if (!d) return "Not synced yet";
  const now   = new Date();
  const today = now.getDate() === d.getDate() && now.getMonth() === d.getMonth();
  const time  = d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
  return `Last synced: ${today ? "Today, " : ""}${time}`;
}

// ─── Video Player Modal ───────────────────────────────────────────────────────

interface PlayerConfig { uri: string; title: string; onShare?: () => void }

function VideoPlayerModal({ config, onClose }: { config: PlayerConfig; onClose: () => void }) {
  const insets  = useSafeAreaInsets();
  const player  = useVideoPlayer(config.uri, (p) => { p.loop = false; p.play(); });
  const [playing,   setPlaying]   = useState(true);
  const [ct,        setCt]        = useState(0);
  const [dur,       setDur]       = useState(0);
  const [ctrlVis,   setCtrlVis]   = useState(true);
  const [speedIdx,  setSpeedIdx]  = useState(1);
  const [barW,      setBarW]      = useState(1);
  const anim      = useRef(new Animated.Value(1)).current;
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      try {
        const c = player.currentTime, d = player.duration;
        setCt(isNaN(c) ? 0 : c);
        if (d && !isNaN(d) && d > 0) setDur(d);
        setPlaying(player.playing);
      } catch { /* not ready */ }
    }, 250);
    return () => clearInterval(id);
  }, [player]);

  const showCtrl = useCallback(() => {
    setCtrlVis(true);
    Animated.timing(anim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setCtrlVis(false));
    }, 4000);
  }, [anim]);

  useEffect(() => { showCtrl(); return () => { if (timerRef.current) clearTimeout(timerRef.current); }; }, [showCtrl]);

  const progress = dur > 0 ? Math.min(1, ct / dur) : 0;
  const fT = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <VideoView player={player as any} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => {
          if (ctrlVis) { Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setCtrlVis(false)); if (timerRef.current) clearTimeout(timerRef.current); }
          else showCtrl();
        }} />
        <Animated.View style={[{ position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 12 }, { opacity: anim }]} pointerEvents={ctrlVis ? "box-none" : "none"}>
          <TouchableOpacity onPress={onClose} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={{ flex: 1, color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" }} numberOfLines={1}>{config.title}</Text>
          {config.onShare
            ? <TouchableOpacity onPress={config.onShare} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="share-outline" size={22} color="#fff" /></TouchableOpacity>
            : <View style={{ width: 44 }} />}
        </Animated.View>
        <Animated.View style={{ opacity: anim }} pointerEvents={ctrlVis ? "box-none" : "none"}>
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.92)"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingTop: 60, paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={{ marginBottom: 16 }} onLayout={(e) => setBarW(Math.max(1, e.nativeEvent.layout.width))}>
              <Pressable style={{ height: 20, justifyContent: "center" }} onPress={(e) => { player.currentTime = (e.nativeEvent.locationX / barW) * dur; }}>
                <View style={{ height: 3, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 1.5, overflow: "hidden" }}>
                  <View style={{ position: "absolute", top: 0, left: 0, height: "100%" as any, width: `${progress * 100}%` as any, backgroundColor: "#22c55e", borderRadius: 1.5 }} />
                </View>
                <View style={{ position: "absolute", top: "50%" as any, left: progress * (barW - 12), width: 12, height: 12, borderRadius: 6, backgroundColor: "#fff", marginTop: -6 }} />
              </Pressable>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular" }}>{fT(ct)}</Text>
                <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular" }}>{fT(dur)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <TouchableOpacity onPress={() => { const n = (speedIdx + 1) % SPEEDS.length; setSpeedIdx(n); player.playbackRate = SPEEDS[n]; }} style={{ width: 52, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)" }}>
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{SPEEDS[speedIdx]}×</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { player.currentTime = Math.max(0, ct - 15); }} style={{ width: 60, height: 60, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="play-back-outline" size={28} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { if (player.playing) player.pause(); else player.play(); }} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={playing ? "pause" : "play"} size={28} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { player.currentTime = Math.min(dur, ct + 15); }} style={{ width: 60, height: 60, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="play-forward-outline" size={28} color="#fff" />
              </TouchableOpacity>
              <View style={{ width: 52 }} />
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Clip Row ─────────────────────────────────────────────────────────────────

function ClipRow({ clip, locationName, loading, onPlay, onMenu }: {
  clip: UnifiedClip;
  locationName: string;
  loading: boolean;
  onPlay: (c: UnifiedClip) => void;
  onMenu: (c: UnifiedClip) => void;
}) {
  const c       = useColors();
  const isEvent = !!clip.lockReason && clip.lockReason !== "manual";
  const typeLabel = isEvent ? "Event" : clip.locked ? "Locked" : "Normal";
  const typeColor = isEvent ? "#FF6B35" : clip.locked ? "#3B82F6" : "#22c55e";

  return (
    <TouchableOpacity
      style={[vs.clipRow, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => onPlay(clip)}
      activeOpacity={0.85}
      disabled={loading}
    >
      {/* Thumbnail */}
      <View style={vs.thumb}>
        <View style={[vs.thumbBg, {
          backgroundColor: isEvent ? "#FF3B3018" : clip.locked ? "#1976D218" : "#1E282099",
        }]}>
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : isEvent
              ? <Ionicons name="shield" size={22} color="#EF4444" />
              : clip.locked
                ? <Ionicons name="lock-closed" size={20} color="#3B82F6" />
                : <Ionicons name="play" size={22} color="rgba(255,255,255,0.7)" />
          }
        </View>
        {/* Duration badge */}
        <View style={vs.durBadge}>
          <Text style={vs.durText}>{fmtDuration(clip.durationS)}</Text>
        </View>
        {/* Cloud indicator */}
        {clip.source === "server" && (
          <View style={[vs.cloudBadge, { backgroundColor: "#1976D2" }]}>
            <Ionicons name="cloud" size={8} color="#fff" />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[vs.clipTitle, { color: c.foreground }]} numberOfLines={1}>{locationName}</Text>
        <Text style={[vs.clipMeta, { color: c.mutedForeground }]}>
          {fmtTime(clip.startedAt)}  ·  {fmtSize(clip.sizeBytes)}
        </Text>
        <View style={[vs.typeBadge, { backgroundColor: typeColor + "22" }]}>
          <View style={[vs.typeDot, { backgroundColor: typeColor }]} />
          <Text style={[vs.typeText, { color: typeColor }]}>{typeLabel}</Text>
        </View>
      </View>

      {/* Menu */}
      <TouchableOpacity
        style={vs.menuBtn}
        onPress={(e) => { e.stopPropagation?.(); onMenu(clip); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={loading}
      >
        <Ionicons name="ellipsis-vertical" size={18} color={c.mutedForeground} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashcamVideosScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const {
    segments, deleteSegment, storageUsedBytes,
    isRecording, openDashcam, pushDeviceId, settings,
    lockCurrentClip,
  } = useDashcam();

  const topInset    = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  // ── State ─────────────────────────────────────────────────────────────────────
  const [vehicles,         setVehicles]         = useState<SavedVehicle[]>([]);
  const [activeIdx,        setActiveIdx]        = useState(0);
  const [serverClips,      setServerClips]      = useState<ServerClip[]>([]);
  const [serverLoading,    setServerLoading]    = useState(false);
  const [locationNames,    setLocationNames]    = useState<Record<string, string>>({});
  const [tab,              setTab]              = useState<Tab>("all");
  const [dateFilter,       setDateFilter]       = useState<DateFilter>("all");
  const [showPicker,       setShowPicker]       = useState(false);
  const [menuClip,         setMenuClip]         = useState<UnifiedClip | null>(null);
  const [playerConfig,     setPlayerConfig]     = useState<PlayerConfig | null>(null);
  const [loadingId,        setLoadingId]        = useState<string | null>(null);
  const [downloadingId,    setDownloadingId]    = useState<string | null>(null);
  const [lastSync,         setLastSync]         = useState<Date | null>(null);
  const locCacheRef = useRef<Record<string, string>>({});

  // ── Load vehicles ─────────────────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    loadVehicles().then(setVehicles).catch(() => {});
  }, []));

  // ── Fetch server clips ─────────────────────────────────────────────────────────
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
      const { clips } = await res.json() as { clips: ServerClip[] };
      setServerClips(clips);
      setLastSync(new Date());
    } catch (err) {
      console.warn("[DashcamVideos] fetch failed:", err);
    } finally {
      setServerLoading(false);
    }
  }, [pushDeviceId]);

  useFocusEffect(useCallback(() => { fetchServerClips(); }, [fetchServerClips]));

  // ── Unified clips ─────────────────────────────────────────────────────────────
  const unifiedClips = useMemo<UnifiedClip[]>(() => {
    const localServerIds = new Set(segments.map((s) => s.serverId).filter(Boolean));
    const serverOnly = serverClips
      .filter((c) => !localServerIds.has(c.id))
      .map((sc): UnifiedClip => ({
        id:        sc.id,
        startedAt: new Date(sc.startedAt).getTime(),
        durationS: sc.durationS ?? 0,
        sizeBytes: sc.sizeBytes ?? 0,
        locked:    true,
        lockReason: sc.lockReason ?? "manual",
        source:    "server",
        lat:       sc.lat ?? undefined,
        lng:       sc.lng ?? undefined,
      }));
    const local = segments.map((s): UnifiedClip => ({
      id:           s.id,
      uri:          s.uri,
      startedAt:    s.startedAt,
      durationS:    s.durationS,
      sizeBytes:    s.sizeBytes,
      locked:       s.locked,
      lockReason:   s.lockReason,
      uploadStatus: s.uploadStatus,
      source:       "local",
      serverId:     s.serverId,
      lat:          (s as any).lat,
      lng:          (s as any).lng,
    }));
    return [...local, ...serverOnly].sort((a, b) => b.startedAt - a.startedAt);
  }, [segments, serverClips]);

  // ── Resolve location names via Photon reverse geocode ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cache = { ...locCacheRef.current };
      // Load cached from AsyncStorage
      for (const clip of unifiedClips) {
        if (cache[clip.id]) continue;
        const stored = await AsyncStorage.getItem(LOC_CACHE_KEY(clip.id)).catch(() => null);
        if (stored) cache[clip.id] = stored;
      }
      if (!cancelled) { locCacheRef.current = cache; setLocationNames({ ...cache }); }
      // Fetch uncached clips that have coordinates
      for (const clip of unifiedClips) {
        if (cancelled || cache[clip.id]) continue;
        if (clip.lat == null || clip.lng == null) continue;
        const name = await photonReverse(clip.lat, clip.lng);
        if (name && !cancelled) {
          cache[clip.id] = name;
          locCacheRef.current = { ...cache };
          setLocationNames({ ...cache });
          AsyncStorage.setItem(LOC_CACHE_KEY(clip.id), name).catch(() => {});
        }
      }
    })();
    return () => { cancelled = true; };
  }, [unifiedClips]);

  // ── Filter + group ────────────────────────────────────────────────────────────
  const listItems = useMemo<ListItem[]>(() => {
    let clips = unifiedClips;
    if (tab === "locked")    clips = clips.filter((c) => c.locked);
    if (tab === "downloads") clips = clips.filter((c) => c.uploadStatus === "uploaded" || c.source === "server");
    clips = clips.filter((c) => inRange(c.startedAt, dateFilter));

    if (clips.length === 0) {
      const msg = tab === "locked"
        ? "No locked clips. Hard braking, crashes, or manual locks appear here."
        : tab === "downloads"
          ? "No backed-up clips yet. Lock a clip to upload it."
          : "No clips match this filter.";
      return [{ type: "empty", message: msg, key: "empty" }];
    }

    const groups = new Map<string, UnifiedClip[]>();
    for (const clip of clips) {
      const lbl = dayLabel(clip.startedAt);
      if (!groups.has(lbl)) groups.set(lbl, []);
      groups.get(lbl)!.push(clip);
    }

    const items: ListItem[] = [];
    for (const [label, gClips] of groups) {
      items.push({ type: "section", label, count: gClips.length, key: `sec_${label}` });
      for (const clip of gClips) {
        items.push({ type: "clip", clip, key: clip.id });
      }
    }
    return items;
  }, [unifiedClips, tab, dateFilter]);

  // ── Play ──────────────────────────────────────────────────────────────────────
  const handlePlay = useCallback(async (clip: UnifiedClip) => {
    Haptics.selectionAsync();
    const title = locationNames[clip.id] ?? timeOfDayName(clip.startedAt);
    if (clip.source === "local" && clip.uri) {
      setPlayerConfig({ uri: clip.uri, title });
      return;
    }
    if (loadingId) return;
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret || !pushDeviceId) return;
      setLoadingId(clip.id);
      const res = await fetch(`${API_BASE}/dashcam/clip/${clip.id}/url`, {
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) { Alert.alert("Error", "Could not load video."); return; }
      const { downloadUrl } = await res.json() as { downloadUrl: string };
      setPlayerConfig({
        uri: downloadUrl, title,
        onShare: async () => {
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) {
            const tmp = `${FileSystem.cacheDirectory}share_player_${clip.id}.mp4`;
            await FileSystem.downloadAsync(downloadUrl, tmp).catch(() => {});
            Sharing.shareAsync(tmp, { mimeType: "video/mp4", dialogTitle: "Share dashcam clip" }).catch(() => {});
          } else {
            RNShare.share({ message: "Msafiri dashcam clip", url: downloadUrl }).catch(() => {});
          }
        },
      });
    } catch { Alert.alert("Error", "Network error."); }
    finally { setLoadingId(null); }
  }, [locationNames, loadingId, pushDeviceId]);

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = useCallback((clip: UnifiedClip) => {
    setMenuClip(null);
    Alert.alert(
      "Delete clip?",
      clip.source === "server"
        ? "This will permanently delete the cloud clip."
        : clip.locked
          ? "This locked clip will be deleted from your device and cloud storage."
          : "This clip will be permanently deleted from your device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          if (clip.source === "local") {
            await deleteSegment(clip.id);
          } else {
            try {
              const secret = await AsyncStorage.getItem(SECRET_KEY);
              if (!secret || !pushDeviceId) return;
              const res = await fetch(`${API_BASE}/dashcam/clip/${clip.id}`, {
                method: "DELETE",
                headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
              });
              if (res.ok) {
                setServerClips((prev) => prev.filter((c) => c.id !== clip.id));
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else Alert.alert("Error", "Could not delete clip.");
            } catch { Alert.alert("Error", "Network error."); }
          }
        }},
      ]
    );
  }, [deleteSegment, pushDeviceId]);

  // ── Share ─────────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async (clip: UnifiedClip) => {
    setMenuClip(null);
    const canShare = await Sharing.isAvailableAsync();

    // Local clip — share the file directly
    if (clip.source === "local" && clip.uri) {
      if (canShare) {
        await Sharing.shareAsync(clip.uri, { mimeType: "video/mp4", dialogTitle: "Share dashcam clip" }).catch(() => {});
      } else {
        RNShare.share({ message: `Msafiri dashcam clip — ${fmtTime(clip.startedAt)}` }).catch(() => {});
      }
      return;
    }

    // Server clip — get signed URL, download to a temp file, then share
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret || !pushDeviceId) { Alert.alert("Error", "Dashcam not connected."); return; }
      const res = await fetch(`${API_BASE}/dashcam/clip/${clip.id}/url`, {
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) { Alert.alert("Error", "Could not get share link."); return; }
      const { downloadUrl } = await res.json() as { downloadUrl: string };

      if (canShare) {
        // Download to cache dir then share so the sheet shows the actual file
        const tmp = `${FileSystem.cacheDirectory}share_${clip.id}.mp4`;
        await FileSystem.downloadAsync(downloadUrl, tmp);
        await Sharing.shareAsync(tmp, { mimeType: "video/mp4", dialogTitle: "Share dashcam clip" }).catch(() => {});
      } else {
        // Fallback: share the signed URL as text
        RNShare.share({ message: "Msafiri dashcam clip", url: downloadUrl }).catch(() => {});
      }
    } catch { Alert.alert("Error", "Could not share clip. Check your connection."); }
  }, [pushDeviceId]);

  // ── Download to device ────────────────────────────────────────────────────────
  const handleDownload = useCallback(async (clip: UnifiedClip) => {
    setMenuClip(null);
    if (clip.source === "local") { Alert.alert("Already on device", "This clip is already saved locally."); return; }
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret || !pushDeviceId) return;
      setDownloadingId(clip.id);
      const res = await fetch(`${API_BASE}/dashcam/clip/${clip.id}/url`, {
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) { Alert.alert("Error", "Could not get download URL."); return; }
      const { downloadUrl } = await res.json() as { downloadUrl: string };
      const dest = `${FileSystem.documentDirectory}dashcam_${clip.id}.mp4`;
      await FileSystem.downloadAsync(downloadUrl, dest);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Downloaded", "Clip saved to your device.");
    } catch { Alert.alert("Error", "Download failed. Check your connection."); }
    finally { setDownloadingId(null); }
  }, [pushDeviceId]);

  // ── Derived display values ────────────────────────────────────────────────────
  const activeVehicle = vehicles[activeIdx] ?? null;
  const vehicleName   = activeVehicle
    ? [
        getMakeById(activeVehicle.makeId ?? "")?.name  ?? activeVehicle.customMakeName,
        getModelById(activeVehicle.makeId ?? "", activeVehicle.modelId ?? "")?.name ?? activeVehicle.customModelName,
      ].filter(Boolean).join(" ") || "My Vehicle"
    : "My Vehicle";

  const totalClips   = unifiedClips.length;
  const lockedCount  = unifiedClips.filter((c) => c.locked).length;
  const usedMB       = (storageUsedBytes / 1_048_576).toFixed(0);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <FlatList
        {...FLAT_LIST_PROPS}
        data={listItems}
        keyExtractor={(item) => item.key}
        style={{ backgroundColor: c.background }}
        contentContainerStyle={{
          paddingTop: topInset + 8,
          paddingBottom: bottomInset + 40,
          paddingHorizontal: 16,
        }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 12 }}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <View style={vs.headerRow}>
              <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={26} color={c.foreground} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[vs.title, { color: c.foreground }]}>Dashcam Videos</Text>
                <Text style={[vs.subtitle, { color: c.mutedForeground }]}>
                  View, manage and protect your dashcam recordings.
                </Text>
              </View>
              <TouchableOpacity
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => Alert.alert(
                  "Dashcam Info",
                  `Quality: ${settings.quality}\nAudio: ${settings.audioEnabled ? "On" : "Off"}\nWi-Fi upload only: ${settings.wifiOnlyUpload ? "Yes" : "No"}\nStorage used: ${usedMB} MB\n\nOpen the dashcam to change settings.`
                )}
              >
                <Ionicons name="settings-outline" size={22} color={c.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* ── Vehicle selector ───────────────────────────────────────── */}
            {vehicles.length > 0 && (
              <>
                <Text style={[vs.sectionMini, { color: c.mutedForeground }]}>Select Vehicle</Text>
                <TouchableOpacity
                  style={[vs.vehicleCard, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => vehicles.length > 1 ? setShowPicker(true) : undefined}
                  activeOpacity={vehicles.length > 1 ? 0.8 : 1}
                >
                  <View style={vs.vehicleInner}>
                    <View style={{ flex: 1 }}>
                      <View style={vs.vehicleNameRow}>
                        <Text style={[vs.vehicleName, { color: c.foreground }]}>{vehicleName}</Text>
                        {activeVehicle?.isDefault && (
                          <View style={vs.primaryBadge}>
                            <Text style={vs.primaryText}>Primary</Text>
                          </View>
                        )}
                      </View>
                      {activeVehicle?.odometerKm ? (
                        <Text style={[vs.vehicleMeta, { color: c.mutedForeground }]}>
                          {activeVehicle.odometerKm.toLocaleString()} km
                        </Text>
                      ) : null}
                    </View>
                    {vehicles.length > 1 && (
                      <Ionicons name="chevron-down" size={20} color={c.mutedForeground} />
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}

            {/* ── Connection status ──────────────────────────────────────── */}
            <View style={[vs.connBar, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={vs.connLeft}>
                <View style={[vs.connIcon, { backgroundColor: "#22c55e1a" }]}>
                  <Ionicons name="videocam" size={18} color="#22c55e" />
                </View>
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={[vs.connDot, {
                      backgroundColor: isRecording ? "#22c55e" : pushDeviceId ? "#22c55e" : "#6B7280",
                    }]} />
                    <Text style={[vs.connTitle, { color: c.foreground }]}>
                      {isRecording ? "Recording" : pushDeviceId ? "Dashcam Connected" : "Not Connected"}
                    </Text>
                  </View>
                  <Text style={[vs.connSub, { color: c.mutedForeground }]}>{syncLabel(lastSync)}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[vs.openBtn, { borderColor: c.primary }]}
                onPress={() => openDashcam()}
              >
                <Text style={[vs.openBtnText, { color: c.primary }]}>Open Dashcam</Text>
                <Ionicons name="open-outline" size={13} color={c.primary} />
              </TouchableOpacity>
            </View>

            {/* ── Quick actions ──────────────────────────────────────────── */}
            <View style={vs.actionsGrid}>
              <TouchableOpacity
                style={[vs.actionCell, { backgroundColor: "#22c55e14", borderColor: "#22c55e30" }]}
                onPress={() => openDashcam()}
              >
                <Ionicons name="videocam" size={24} color="#22c55e" />
                <Text style={[vs.actionLabel, { color: c.foreground }]}>Live View</Text>
                <Text style={[vs.actionSub, { color: c.mutedForeground }]}>Real-time feed</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[vs.actionCell, { backgroundColor: "#3B82F614", borderColor: "#3B82F630" }]}
                onPress={fetchServerClips}
              >
                <Ionicons name="cloud-download-outline" size={24} color="#3B82F6" />
                <Text style={[vs.actionLabel, { color: c.foreground }]}>Download</Text>
                <Text style={[vs.actionSub, { color: c.mutedForeground }]}>Get recent videos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[vs.actionCell, { backgroundColor: "#EF444414", borderColor: "#EF444430" }]}
                onPress={() => { setTab("locked"); setDateFilter("all"); }}
              >
                <Ionicons name="shield" size={24} color="#EF4444" />
                <Text style={[vs.actionLabel, { color: c.foreground }]}>Emergency</Text>
                <Text style={[vs.actionSub, { color: c.mutedForeground }]}>Locked videos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[vs.actionCell, { backgroundColor: "#8B5CF614", borderColor: "#8B5CF630" }]}
                onPress={() => router.push("/(tabs)/settings" as any)}
              >
                <Ionicons name="settings-outline" size={24} color="#8B5CF6" />
                <Text style={[vs.actionLabel, { color: c.foreground }]}>Settings</Text>
                <Text style={[vs.actionSub, { color: c.mutedForeground }]}>Dashcam setup</Text>
              </TouchableOpacity>
            </View>

            {/* ── Stats strip ────────────────────────────────────────────── */}
            <View style={[vs.statsRow, { backgroundColor: c.card, borderColor: c.border }]}>
              {[
                { n: totalClips,  l: "Total" },
                { n: lockedCount, l: "Locked" },
                { n: `${usedMB} MB`, l: "Used" },
              ].map((s, i, arr) => (
                <React.Fragment key={s.l}>
                  <View style={vs.statItem}>
                    <Text style={[vs.statNum, { color: c.foreground }]}>{s.n}</Text>
                    <Text style={[vs.statLbl, { color: c.mutedForeground }]}>{s.l}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[vs.statDiv, { backgroundColor: c.border }]} />}
                </React.Fragment>
              ))}
            </View>

            {/* ── Tabs ───────────────────────────────────────────────────── */}
            <View style={[vs.tabStrip, { backgroundColor: c.card, borderColor: c.border }]}>
              {(["all", "locked", "downloads"] as Tab[]).map((t) => {
                const active = tab === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[vs.tabBtn, active && { backgroundColor: c.primary + "1a", borderRadius: 9, borderWidth: 1, borderColor: c.primary }]}
                    onPress={() => setTab(t)}
                  >
                    {t === "locked"    && <Ionicons name="lock-closed" size={11} color={active ? c.primary : c.mutedForeground} />}
                    {t === "downloads" && <Ionicons name="cloud-download-outline" size={11} color={active ? c.primary : c.mutedForeground} />}
                    <Text style={[vs.tabText, { color: active ? c.primary : c.mutedForeground }, active && vs.tabTextBold]}>
                      {t === "all" ? "All Videos" : t === "locked" ? "Locked" : "Downloads"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Date chips ─────────────────────────────────────────────── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
              {(["all", "today", "yesterday", "week"] as DateFilter[]).map((f) => {
                const active = dateFilter === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[vs.chip, {
                      backgroundColor: active ? c.primary : c.card,
                      borderColor:     active ? c.primary : c.border,
                    }]}
                    onPress={() => setDateFilter(f)}
                  >
                    <Text style={[vs.chipText, { color: active ? "#fff" : c.mutedForeground }]}>
                      {f === "all" ? "All" : f === "today" ? "Today" : f === "yesterday" ? "Yesterday" : "This Week"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {serverLoading && (
                <ActivityIndicator size="small" color={c.primary} style={{ marginLeft: 6 }} />
              )}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => {
          if (item.type === "section") {
            return (
              <View style={vs.dayHeader}>
                <Text style={[vs.dayLabel, { color: c.foreground }]}>{item.label}</Text>
                <Text style={[vs.dayCount, { color: c.mutedForeground }]}>
                  {item.count} video{item.count !== 1 ? "s" : ""}
                </Text>
              </View>
            );
          }
          if (item.type === "empty") {
            return (
              <View style={vs.empty}>
                <Ionicons name="videocam-outline" size={48} color={c.mutedForeground} />
                <Text style={[vs.emptyTitle, { color: c.foreground }]}>No clips</Text>
                <Text style={[vs.emptySub, { color: c.mutedForeground }]}>{item.message}</Text>
              </View>
            );
          }
          const { clip } = item;
          const isLoading = loadingId === clip.id || downloadingId === clip.id;
          return (
            <View style={{ marginBottom: 8 }}>
              <ClipRow
                clip={clip}
                locationName={locationNames[clip.id] ?? timeOfDayName(clip.startedAt)}
                loading={isLoading}
                onPlay={handlePlay}
                onMenu={setMenuClip}
              />
            </View>
          );
        }}
      />

      {/* ── Vehicle picker ────────────────────────────────────────────────── */}
      {showPicker && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
          <Pressable style={vs.overlay} onPress={() => setShowPicker(false)} />
          <View style={[vs.sheet, { backgroundColor: c.card, paddingBottom: bottomInset + 20 }]}>
            <View style={[vs.handle, { backgroundColor: c.border }]} />
            <Text style={[vs.sheetTitle, { color: c.foreground }]}>Select Vehicle</Text>
            {vehicles.map((v, idx) => {
              const nm = [
                getMakeById(v.makeId ?? "")?.name  ?? v.customMakeName,
                getModelById(v.makeId ?? "", v.modelId ?? "")?.name ?? v.customModelName,
              ].filter(Boolean).join(" ") || "Vehicle";
              const active = idx === activeIdx;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[vs.vehicleOpt, { borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary + "10" : "transparent" }]}
                  onPress={() => { setActiveIdx(idx); setShowPicker(false); Haptics.selectionAsync(); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[vs.vehicleOptName, { color: c.foreground }]}>{nm}</Text>
                    {v.isDefault && <Text style={[vs.vehicleOptSub, { color: c.mutedForeground }]}>Primary vehicle</Text>}
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={20} color={c.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Modal>
      )}

      {/* ── Clip context menu ─────────────────────────────────────────────── */}
      {menuClip && (
        <Modal transparent animationType="slide" onRequestClose={() => setMenuClip(null)}>
          <Pressable style={vs.overlay} onPress={() => setMenuClip(null)} />
          <View style={[vs.sheet, { backgroundColor: c.card, paddingBottom: bottomInset + 20 }]}>
            <View style={[vs.handle, { backgroundColor: c.border }]} />
            <Text style={[vs.sheetTitle, { color: c.foreground }]} numberOfLines={1}>
              {locationNames[menuClip.id] ?? timeOfDayName(menuClip.startedAt)}
            </Text>
            <Text style={[vs.sheetSub, { color: c.mutedForeground }]}>
              {fmtTime(menuClip.startedAt)}  ·  {fmtSize(menuClip.sizeBytes)}
            </Text>

            {([
              {
                icon: "play-circle-outline" as const,
                label: "Play",
                onPress: () => { const cl = menuClip; setMenuClip(null); handlePlay(cl); },
              },
              {
                icon: "share-outline" as const,
                label: "Share",
                onPress: () => handleShare(menuClip),
              },
              menuClip.source === "server" ? {
                icon: "download-outline" as const,
                label: "Download to Device",
                onPress: () => handleDownload(menuClip),
              } : null,
              menuClip.source === "local" && !menuClip.locked ? {
                icon: "lock-closed-outline" as const,
                label: "Lock Clip",
                onPress: () => {
                  setMenuClip(null);
                  lockCurrentClip("manual");
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                },
              } : null,
              {
                icon: "trash-outline" as const,
                label: "Delete",
                danger: true,
                onPress: () => handleDelete(menuClip),
              },
            ] as const).filter(Boolean).map((opt: any, i) => (
              <TouchableOpacity
                key={i}
                style={[vs.menuOpt, { borderColor: c.border }]}
                onPress={opt.onPress}
              >
                <Ionicons name={opt.icon} size={20} color={opt.danger ? "#EF4444" : c.foreground} />
                <Text style={[vs.menuOptText, { color: opt.danger ? "#EF4444" : c.foreground }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Modal>
      )}

      {/* ── Video player ──────────────────────────────────────────────────── */}
      {playerConfig && (
        <VideoPlayerModal config={playerConfig} onClose={() => setPlayerConfig(null)} />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const vs = StyleSheet.create({
  headerRow:    { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title:        { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle:     { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  sectionMini:  { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },

  vehicleCard:  { borderRadius: 14, borderWidth: 1, padding: 14 },
  vehicleInner: { flexDirection: "row", alignItems: "center", gap: 12 },
  vehicleNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  vehicleName:  { fontSize: 16, fontFamily: "Inter_700Bold" },
  vehicleMeta:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  primaryBadge: { backgroundColor: "#22c55e1a", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  primaryText:  { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#22c55e" },

  connBar:  { borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  connLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  connIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  connDot:  { width: 7, height: 7, borderRadius: 3.5 },
  connTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  connSub:  { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  openBtn:  { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  openBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionCell:  { width: "48%" as any, padding: 14, borderRadius: 14, borderWidth: 1, gap: 5 },
  actionLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actionSub:   { fontSize: 11, fontFamily: "Inter_400Regular" },

  statsRow:  { flexDirection: "row", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  statItem:  { flex: 1, alignItems: "center", paddingVertical: 12, gap: 2 },
  statNum:   { fontSize: 16, fontFamily: "Inter_700Bold" },
  statLbl:   { fontSize: 11, fontFamily: "Inter_500Medium" },
  statDiv:   { width: 1 },

  tabStrip:    { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, gap: 3 },
  tabBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8 },
  tabText:     { fontSize: 12, fontFamily: "Inter_500Medium" },
  tabTextBold: { fontFamily: "Inter_600SemiBold" },

  chip:     { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, marginTop: 4 },
  dayLabel:  { fontSize: 15, fontFamily: "Inter_700Bold" },
  dayCount:  { fontSize: 12, fontFamily: "Inter_400Regular" },

  clipRow:  { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 10 },
  thumb:    { width: 110, height: 72, borderRadius: 10, overflow: "hidden", position: "relative" },
  thumbBg:  { flex: 1, alignItems: "center", justifyContent: "center" },
  durBadge: { position: "absolute", bottom: 5, left: 6, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  durText:  { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  cloudBadge: { position: "absolute", top: 5, right: 5, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  clipTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  clipMeta:  { fontSize: 11, fontFamily: "Inter_400Regular" },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  typeDot:   { width: 5, height: 5, borderRadius: 2.5 },
  typeText:  { fontSize: 11, fontFamily: "Inter_500Medium" },
  menuBtn:   { padding: 6 },

  empty:      { alignItems: "center", gap: 12, paddingVertical: 60, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  emptySub:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  handle:     { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sheetSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, marginBottom: 10 },

  vehicleOpt:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  vehicleOptName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  vehicleOptSub:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  menuOpt:     { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  menuOptText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
