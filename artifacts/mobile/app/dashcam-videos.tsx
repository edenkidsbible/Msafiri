/**
 * dashcam-videos.tsx — Dashcam video gallery.
 *
 * Features:
 *  • Video thumbnails generated from local clips
 *  • Download sheet with per-clip progress bars
 *  • Share as link (instant) or share file
 *  • Full player controls: play/pause, ±15 s, seek, speed, buffering indicator
 *  • Metadata watermark overlay in player (time, location, speed, vehicle)
 *  • Start Driving → pre-trip checklist
 *  • Vehicle selector, date-range filter chips, date-grouped clip list
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ActivityIndicator, Alert, Animated, BackHandler, FlatList, Image, Linking, Modal, Platform,
  Pressable, ScrollView, Share as RNShare, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import * as VideoThumbnails from "expo-video-thumbnails";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";
import { useDashcam, type DashcamSegment } from "@/context/DashcamContext";
import { useVehicle } from "@/context/VehicleContext";
import { FLAT_LIST_PROPS } from "@/lib/scrollProps";
import { API_BASE } from "@/utils/apiClient";
import { getMakeById, getModelById } from "@/data/carModels";
import {
  VideoPlayerModal,
  type PlayerConfig,
  type PlayerMeta,
  PLAYER_SPEEDS,
  fmtDateTime,
} from "@/components/VideoPlayerModal";
import { watermarkedPath } from "@/utils/videoWatermark";

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
  speedKmh: number | null;
  pinned: boolean;
  expiresAt: string | null;
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
  speedKmh?: number;
  pinned?: boolean;
  expiresAt?: string | null;
}

type Tab        = "all" | "locked" | "downloads";
type DateFilter = "all" | "today" | "yesterday" | "week";

type ListItem =
  | { type: "section"; label: string; count: number; key: string }
  | { type: "clip";    clip: UnifiedClip;            key: string }
  | { type: "empty";   message: string;              key: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const SECRET_KEY       = "dashcam_secret_v1";
const LOC_CACHE_KEY    = (id: string) => `dc_loc_v1_${id}`;
const MAX_PINS_PER_DEVICE = 5;

/** Module-level thumbnail URI cache — survives re-renders in the same session. */
const thumbCache = new Map<string, string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function fmtSize(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
}

function timeOfDayName(ms: number): string {
  const h = new Date(ms).getHours();
  if (h < 6)  return "Pre-dawn drive";
  if (h < 12) return "Morning drive";
  if (h < 17) return "Afternoon drive";
  if (h < 20) return "Evening drive";
  return "Night drive";
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" });
}

function inRange(ms: number, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const now = new Date();
  const d   = new Date(ms);
  if (filter === "today") {
    return d.toDateString() === now.toDateString();
  }
  if (filter === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return d.toDateString() === y.toDateString();
  }
  if (filter === "week") {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    return ms >= weekAgo.getTime();
  }
  return true;
}

/**
 * Returns a human-readable expiry string for a cloud clip.
 * - Pinned clips: "Pinned · 60 days"
 * - Regular clips: "Deletes in X days" or "< 1 day"
 * - No expiry set: null
 */
function fmtExpiry(expiresAt: string | null | undefined, pinned: boolean | undefined): string | null {
  if (pinned) return "Pinned · 60 days";
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expires soon";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "< 1 day";
  return `Deletes in ${days} day${days !== 1 ? "s" : ""}`;
}

function syncLabel(d: Date | null): string {
  if (!d) return "Not synced yet";
  const now = new Date();
  const today = now.getDate() === d.getDate() && now.getMonth() === d.getMonth();
  const time  = d.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
  return `Last synced: ${today ? "Today, " : ""}${time}`;
}

/**
 * Reverse geocode a coordinate via the API server (HERE Maps backend).
 * Avoids exposing a secret key in client code and gives much better coverage
 * for Kenya than the public Photon service.
 * Uses a manual AbortController + setTimeout instead of AbortSignal.timeout()
 * for maximum compatibility across Hermes versions.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!API_BASE) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(
      `${API_BASE}/geocode/reverse?lat=${lat}&lng=${lng}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json() as { name?: string | null };
    return j.name ?? null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

// ─── Clip Row ─────────────────────────────────────────────────────────────────

function ClipRow({
  clip, locationName, loading, pinLoading, pinLimitReached, thumbnailUri, downloadProgress, onPlay, onMenu, onPin,
}: {
  clip: UnifiedClip;
  locationName: string;
  loading: boolean;
  /** True while a pin/unpin request is in-flight for this clip. */
  pinLoading?: boolean;
  /** True when the device has already used all MAX_PINS_PER_DEVICE slots. */
  pinLimitReached?: boolean;
  thumbnailUri?: string;
  downloadProgress?: number;   // 0–1 when downloading, undefined otherwise
  onPlay: (c: UnifiedClip) => void;
  onMenu: (c: UnifiedClip) => void;
  onPin?: (c: UnifiedClip) => void;
}) {
  const c       = useColors();
  const isEvent = !!clip.lockReason && clip.lockReason !== "manual";
  const typeLabel = isEvent ? "Event" : clip.locked ? "Locked" : "Normal";
  const typeColor = isEvent ? "#FF6B35" : clip.locked ? "#3B82F6" : "#22c55e";

  // Show cloud metadata for server-only clips AND local clips that have been uploaded
  const isCloudClip = clip.source === "server" || !!clip.serverId;
  const expiryLabel = isCloudClip ? fmtExpiry(clip.expiresAt, clip.pinned) : null;
  const isPinned    = !!clip.pinned;

  return (
    <TouchableOpacity
      style={[vs.clipRow, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={() => onPlay(clip)}
      activeOpacity={0.85}
      disabled={loading}
    >
      {/* Thumbnail */}
      <View style={vs.thumb}>
        {thumbnailUri
          ? (
            <Image
              source={{ uri: thumbnailUri }}
              style={[StyleSheet.absoluteFill, { borderRadius: 10 }]}
              resizeMode="cover"
            />
          )
          : (
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
          )
        }
        {/* Play overlay on thumbnail */}
        {thumbnailUri && !loading && (
          <View style={vs.thumbPlay}>
            <Ionicons name="play" size={16} color="#fff" />
          </View>
        )}
        {/* Duration badge */}
        <View style={vs.durBadge}>
          <Text style={vs.durText}>{fmtDuration(clip.durationS)}</Text>
        </View>
        {/* Cloud indicator — shown for server-only clips and local clips that have been uploaded */}
        {isCloudClip && (
          <View style={[vs.cloudBadge, { backgroundColor: isPinned ? "#F59E0B" : "#1976D2" }]}>
            <Ionicons name={isPinned ? "pin" : "cloud"} size={8} color="#fff" />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[vs.clipTitle, { color: c.foreground }]} numberOfLines={1}>{locationName}</Text>
        <Text style={[vs.clipMeta, { color: c.mutedForeground }]}>
          {fmtDateTime(clip.startedAt)}  ·  {fmtSize(clip.sizeBytes)}
        </Text>
        {downloadProgress != null
          ? (
            <View style={{ gap: 3 }}>
              <View style={{ height: 4, backgroundColor: c.muted, borderRadius: 2, overflow: "hidden" }}>
                <View style={{ height: "100%", width: `${Math.round(downloadProgress * 100)}%` as any, backgroundColor: "#3B82F6", borderRadius: 2 }} />
              </View>
              <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: "#3B82F6" }}>
                Downloading {Math.round(downloadProgress * 100)}%
              </Text>
            </View>
          )
          : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <View style={[vs.typeBadge, { backgroundColor: typeColor + "22" }]}>
                <View style={[vs.typeDot, { backgroundColor: typeColor }]} />
                <Text style={[vs.typeText, { color: typeColor }]}>{typeLabel}</Text>
              </View>
              {expiryLabel && (
                <View style={[vs.typeBadge, { backgroundColor: isPinned ? "#F59E0B22" : "#6B728022" }]}>
                  <Text style={[vs.typeText, { color: isPinned ? "#F59E0B" : c.mutedForeground }]}>
                    {expiryLabel}
                  </Text>
                </View>
              )}
            </View>
          )
        }
      </View>

      {/* Pin button — shown for server-only clips and uploaded local clips */}
      {isCloudClip && onPin && (
        <TouchableOpacity
          style={vs.pinBtn}
          onPress={(e) => { e.stopPropagation?.(); onPin(clip); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          disabled={loading || pinLoading}
        >
          {pinLoading
            ? <ActivityIndicator size="small" color="#F59E0B" />
            : (() => {
                // Limit reached and this clip isn't pinned — show a muted pin to
                // signal the slot is unavailable without hiding the button entirely.
                const atLimitUnpinned = !isPinned && pinLimitReached;
                return (
                  <Ionicons
                    name={isPinned ? "pin" : "pin-outline"}
                    size={18}
                    color={isPinned ? "#F59E0B" : atLimitUnpinned ? c.border : c.mutedForeground}
                  />
                );
              })()
          }
        </TouchableOpacity>
      )}

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
    lockCurrentClip, cloudQuotaFull, clearCloudQuotaFull,
  } = useDashcam();

  const { fromSummary } = useLocalSearchParams<{ fromSummary?: string }>();
  const goBack = useCallback(() => {
    if (fromSummary === "1") router.replace("/(tabs)");
    else router.back();
  }, [fromSummary]);

  useEffect(() => {
    if (fromSummary !== "1") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      router.replace("/(tabs)");
      return true;
    });
    return () => sub.remove();
  }, [fromSummary]);

  const topInset    = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  // ── Vehicle context ────────────────────────────────────────────────────────
  const { vehicles, activeVehicleId, setActiveVehicle } = useVehicle();

  // ── State ──────────────────────────────────────────────────────────────────
  const [serverClips,     setServerClips]     = useState<ServerClip[]>([]);
  const [serverLoading,   setServerLoading]   = useState(false);
  const [locationNames,   setLocationNames]   = useState<Record<string, string>>({});
  const [tab,             setTab]             = useState<Tab>("all");
  const [dateFilter,      setDateFilter]      = useState<DateFilter>("all");
  const [showPicker,      setShowPicker]      = useState(false);
  const [menuClip,        setMenuClip]        = useState<UnifiedClip | null>(null);
  const [playerConfig,    setPlayerConfig]    = useState<PlayerConfig | null>(null);
  const [loadingId,       setLoadingId]       = useState<string | null>(null);
  const [sharingId,       setSharingId]       = useState<string | null>(null);
  const [downloadProgress,setDownloadProgress]= useState<Record<string, number>>({});
  const [lastSync,        setLastSync]        = useState<Date | null>(null);
  const [thumbnails,      setThumbnails]      = useState<Record<string, string>>({});
  const [showDownloadSheet, setShowDownloadSheet] = useState(false);
  const locCacheRef = useRef<Record<string, string>>({});

  // ── Fetch server clips ─────────────────────────────────────────────────────
  const fetchServerClips = useCallback(async () => {
    if (!pushDeviceId || !API_BASE) return;
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret) return;
      setServerLoading(true);
      // Filter by active vehicle so cloud clips for other cars don't show here.
      // For the primary/default vehicle also include unattributed rows (vehicle_id
      // IS NULL) so clips uploaded before per-vehicle scoping was added still appear.
      const url = new URL(`${API_BASE}/dashcam/clips`);
      if (activeVehicleId) {
        url.searchParams.set("vehicleId", activeVehicleId);
        if (activeVehicle?.isDefault) url.searchParams.set("includeUnattributed", "true");
      }
      const res = await fetch(url.toString(), {
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
  }, [pushDeviceId, activeVehicleId]);

  useFocusEffect(useCallback(() => { fetchServerClips(); }, [fetchServerClips]));

  // ── Pin pending set — tracks clips with an in-flight pin/unpin request ──────
  // Stored as state (not a ref) so ClipRow re-renders to show/hide the spinner.
  const [pinPending, setPinPending] = useState<Set<string>>(new Set());

  // ── Pin slot counters — derived early so handlePin can read a fresh value ───
  // pinnedCount is the authoritative count from the latest server fetch.
  const pinnedCount     = serverClips.filter((sc) => sc.pinned).length;
  const pinLimitReached = pinnedCount >= MAX_PINS_PER_DEVICE;

  // Pin/unpin handler — exposed separately from context since server-only clips
  // don't live in segments[]. Calls the API directly, then re-fetches the full
  // clip list so expiresAt shows the server's authoritative value.
  const handlePin = useCallback(async (clip: UnifiedClip) => {
    if (!pushDeviceId || !API_BASE) return;
    const clipId = clip.serverId ?? clip.id;

    // Block double-taps — ignore if a request is already in-flight for this clip
    if (pinPending.has(clipId)) return;

    const isPinned = !!clip.pinned;

    // If the limit is already reached and the driver taps an unpinned clip,
    // explain the situation upfront instead of letting the server reject it.
    if (!isPinned && pinLimitReached) {
      Alert.alert(
        "Pin Limit Reached",
        `You already have ${MAX_PINS_PER_DEVICE} clips pinned. Unpin one to free up a slot.`,
      );
      return;
    }

    setPinPending((prev) => new Set(prev).add(clipId));
    try {
      const secret = await AsyncStorage.getItem(SECRET_KEY);
      if (!secret) return;
      const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}/pin`, {
        method: isPinned ? "DELETE" : "POST",
        headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { code?: string };
        if (body.code === "PIN_LIMIT") {
          Alert.alert("Pin Limit Reached", "You can only pin 5 clips at a time. Unpin a clip first.");
          return;
        }
        Alert.alert("Error", isPinned ? "Could not unpin this clip." : "Could not pin this clip.");
        return;
      }
      // Re-fetch so expiresAt reflects the server's authoritative value rather
      // than a client-estimated one (avoids drift on unusual upload times).
      await fetchServerClips();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Network error.");
    } finally {
      setPinPending((prev) => { const next = new Set(prev); next.delete(clipId); return next; });
    }
  }, [pushDeviceId, pinPending, pinLimitReached, fetchServerClips]);

  // ── Unified clips ──────────────────────────────────────────────────────────
  const unifiedClips = useMemo<UnifiedClip[]>(() => {
    // Build a fast lookup so local segments with a serverId can inherit cloud
    // metadata (pinned, expiresAt) returned by the server.
    const serverClipById = new Map(serverClips.map((sc) => [sc.id, sc]));

    const localServerIds = new Set(segments.map((s) => s.serverId).filter(Boolean));
    const serverOnly = serverClips
      .filter((c) => !localServerIds.has(c.id))
      .map((sc): UnifiedClip => ({
        id:         sc.id,
        startedAt:  new Date(sc.startedAt).getTime(),
        durationS:  sc.durationS ?? 0,
        sizeBytes:  sc.sizeBytes ?? 0,
        locked:     true,
        lockReason: sc.lockReason ?? "manual",
        source:     "server",
        lat:        sc.lat ?? undefined,
        lng:        sc.lng ?? undefined,
        speedKmh:   sc.speedKmh ?? undefined,
        pinned:     sc.pinned,
        expiresAt:  sc.expiresAt,
      }));
    const local = segments.map((s): UnifiedClip => {
      // For uploaded local segments, pull pinned + expiresAt from the server
      // response so the clip card shows the correct expiry label and pin state.
      const sc = s.serverId ? serverClipById.get(s.serverId) : undefined;
      return {
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
        lat:          s.lat,
        lng:          s.lng,
        pinned:       sc?.pinned,
        expiresAt:    sc?.expiresAt,
      };
    });
    return [...local, ...serverOnly].sort((a, b) => b.startedAt - a.startedAt);
  }, [segments, serverClips]);

  // ── Generate thumbnails for local clips ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const clip of unifiedClips) {
        if (cancelled) return;
        if (!clip.uri || thumbnails[clip.id] || thumbCache.has(clip.id)) {
          // Use cached value
          if (thumbCache.has(clip.id) && !thumbnails[clip.id]) {
            setThumbnails((prev) => ({ ...prev, [clip.id]: thumbCache.get(clip.id)! }));
          }
          continue;
        }
        try {
          const result = await VideoThumbnails.getThumbnailAsync(clip.uri, { time: 1500 });
          if (!cancelled && result?.uri) {
            thumbCache.set(clip.id, result.uri);
            setThumbnails((prev) => ({ ...prev, [clip.id]: result.uri }));
          }
        } catch {
          // Thumbnail gen failed — keep fallback icon
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedClips]);

  // ── Resolve location names via API-proxied HERE reverse geocode ────────────
  //
  // Key the effect on a stable hash of clip ID + coords only.  Metadata
  // changes (pin status, expiry, upload progress) should NOT cancel an
  // in-progress geocoding pass — they don't affect which clips need geocoding.
  const coordsKey = useMemo(
    () => unifiedClips.map((c) => `${c.id}:${c.lat ?? ""}:${c.lng ?? ""}`).join("|"),
    [unifiedClips],
  );
  useEffect(() => {
    let cancelled = false;
    // Snapshot the clips that actually need geocoding at the time this effect
    // runs.  The closure captures `unifiedClips` from the enclosing render.
    const clipsToProcess = unifiedClips;
    (async () => {
      // 1. Warm the in-memory cache from AsyncStorage for all current clips.
      const cache = { ...locCacheRef.current };
      for (const clip of clipsToProcess) {
        if (cache[clip.id]) continue;
        const stored = await AsyncStorage.getItem(LOC_CACHE_KEY(clip.id)).catch(() => null);
        if (stored) cache[clip.id] = stored;
      }
      if (!cancelled) { locCacheRef.current = cache; setLocationNames({ ...cache }); }

      // 2. Geocode clips that still have no name but do have coordinates.
      for (const clip of clipsToProcess) {
        if (cancelled || cache[clip.id]) continue;
        if (clip.lat == null || clip.lng == null) continue;
        const name = await reverseGeocode(clip.lat, clip.lng);
        if (name && !cancelled) {
          cache[clip.id] = name;
          locCacheRef.current = { ...cache };
          setLocationNames({ ...cache });
          AsyncStorage.setItem(LOC_CACHE_KEY(clip.id), name).catch(() => {});
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsKey]);

  // ── Filter + group ─────────────────────────────────────────────────────────
  const listItems = useMemo<ListItem[]>(() => {
    let clips = unifiedClips;
    if (tab === "locked")    clips = clips.filter((c) => c.locked);
    if (tab === "downloads") clips = clips.filter((c) => c.uploadStatus === "uploaded" || c.source === "server");
    clips = clips.filter((c) => inRange(c.startedAt, dateFilter));

    // Cap normal (unlocked) clips at 10 most recent in the "All" tab.
    // Locked clips are always shown in full — only the rolling normal clips
    // are capped since they have limited retention value after 10 anyway.
    if (tab === "all") {
      let normalSeen = 0;
      clips = clips.filter((c) => {
        if (c.locked) return true;
        normalSeen++;
        return normalSeen <= 10;
      });
    }

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
      for (const clip of gClips) items.push({ type: "clip", clip, key: clip.id });
    }
    return items;
  }, [unifiedClips, tab, dateFilter]);

  // ── Vehicle helpers ────────────────────────────────────────────────────────
  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? vehicles[0] ?? null;
  const vehicleName   = activeVehicle
    ? [
        getMakeById(activeVehicle.makeId ?? "")?.name  ?? activeVehicle.customMakeName,
        getModelById(activeVehicle.makeId ?? "", activeVehicle.modelId ?? "")?.name ?? activeVehicle.customModelName,
      ].filter(Boolean).join(" ") || "My Vehicle"
    : "My Vehicle";

  /** Build the meta block passed to the video player. */
  const buildPlayerMeta = useCallback((clip: UnifiedClip): PlayerMeta => ({
    startedAt:    clip.startedAt,
    locationName: locationNames[clip.id] ?? timeOfDayName(clip.startedAt),
    vehicleName,
    plate:        activeVehicle?.plateNumber,
    speedKmh:     clip.speedKmh,
  }), [locationNames, vehicleName, activeVehicle]);

  // ── Shared helper: get a signed URL for a server clip (playback only) ───────
  const getSignedUrl = useCallback(async (clipId: string): Promise<string | null> => {
    const secret = await AsyncStorage.getItem(SECRET_KEY);
    if (!secret || !pushDeviceId) return null;
    const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}/url`, {
      headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
    });
    if (!res.ok) return null;
    const { downloadUrl } = await res.json() as { downloadUrl: string };
    return downloadUrl;
  }, [pushDeviceId]);

  // ── Shared helper: get a branded short link for external sharing ───────────
  // Returns a stable msafirikenya.com/c/{token} URL that redirects to R2.
  // The token is created server-side on first call and reused thereafter.
  const getShareLink = useCallback(async (clipId: string): Promise<string | null> => {
    const secret = await AsyncStorage.getItem(SECRET_KEY);
    if (!secret || !pushDeviceId) return null;
    const res = await fetch(`${API_BASE}/dashcam/clip/${clipId}/share-link`, {
      headers: { "X-Device-Id": pushDeviceId, "X-Dashcam-Secret": secret },
    });
    if (!res.ok) return null;
    const { shortUrl } = await res.json() as { shortUrl: string };
    return shortUrl ?? null;
  }, [pushDeviceId]);

  // ── Share URL (used by player and handlePlay's onShare closure) ───────────
  const handleShareUrl = useCallback(async (url: string, clip: UnifiedClip) => {
    const name = locationNames[clip.id] ?? timeOfDayName(clip.startedAt);
    // Include the URL inside the message text so Android (which ignores the
    // `url` field in Share.share) still shares a clickable link.  iOS uses
    // the `url` field to show a native preview; the in-message URL is a safe
    // fallback on both platforms.
    const msg  = `Msafiri dashcam clip — ${name}, ${fmtDateTime(clip.startedAt)}\n${url}`;
    try {
      await RNShare.share({ message: msg, url });
    } catch { /* user cancelled */ }
  }, [locationNames]);

  // ── Play ───────────────────────────────────────────────────────────────────
  const handlePlay = useCallback(async (clip: UnifiedClip) => {
    Haptics.selectionAsync();
    const title = locationNames[clip.id] ?? timeOfDayName(clip.startedAt);
    const meta  = buildPlayerMeta(clip);

    if (clip.source === "local" && clip.uri) {
      setPlayerConfig({ uri: clip.uri, title, meta });
      return;
    }
    if (loadingId) return;
    try {
      setLoadingId(clip.id);
      const url = await getSignedUrl(clip.id);
      if (!url) { Alert.alert("Error", "Could not load video."); return; }
      // onShare — use the branded short link, not the raw presigned URL.
      // getShareLink is called lazily so it doesn't delay playback start.
      const onShare = async () => {
        const shortUrl = await getShareLink(clip.id);
        if (shortUrl) {
          handleShareUrl(shortUrl, clip);
        } else {
          // Fall back to the presigned URL if short-link generation fails.
          handleShareUrl(url, clip);
        }
      };
      setPlayerConfig({ uri: url, title, meta, onShare });
    } catch { Alert.alert("Error", "Network error."); }
    finally { setLoadingId(null); }
  }, [locationNames, loadingId, buildPlayerMeta, getSignedUrl, getShareLink, handleShareUrl]);

  // ── Download to device, burn watermark, & save to photo library ─────────────
  const handleDownload = useCallback(async (clip: UnifiedClip) => {
    setMenuClip(null);
    if (clip.source === "local") {
      Alert.alert("Already on device", "This clip is already saved to your device.");
      return;
    }
    if (downloadProgress[clip.id] != null) return; // already in progress
    try {
      const url = await getSignedUrl(clip.id);
      if (!url) { Alert.alert("Error", "Could not get download URL."); return; }

      // Download to a temporary location first
      const dest = `${FileSystem.documentDirectory}dashcam_${clip.id}.mp4`;
      const task = FileSystem.createDownloadResumable(
        url,
        dest,
        {},
        (prog) => {
          const ratio = prog.totalBytesExpectedToWrite > 0
            ? prog.totalBytesWritten / prog.totalBytesExpectedToWrite
            : 0;
          // Reserve 0–0.85 for download, 0.85–1.0 for watermark processing
          setDownloadProgress((prev) => ({ ...prev, [clip.id]: ratio * 0.85 }));
        }
      );
      setDownloadProgress((prev) => ({ ...prev, [clip.id]: 0 }));
      await task.downloadAsync();

      // Save to the device's photo/video library
      if (Platform.OS !== "web") {
        const { status } = await MediaLibrary.requestPermissionsAsync();

        if (status === "granted") {
          try {
            // ── Burn metadata watermark into the video ──────────────────────
            // watermarkedPath() tries FFmpegKit; if unavailable (Expo Go) it
            // returns `dest` unchanged so the save still works.
            setDownloadProgress((prev) => ({ ...prev, [clip.id]: 0.87 }));
            const meta = buildPlayerMeta(clip);
            const fileToSave = await watermarkedPath(dest, {
              locationName: meta.locationName,
              startedAt:    meta.startedAt,
              vehicleName:  meta.vehicleName,
              plate:        meta.plate,
              speedKmh:     meta.speedKmh,
            });
            setDownloadProgress((prev) => ({ ...prev, [clip.id]: 0.97 }));

            await MediaLibrary.saveToLibraryAsync(fileToSave);

            // Clean up both the raw download and the watermarked copy.
            FileSystem.deleteAsync(dest,       { idempotent: true }).catch(() => {});
            if (fileToSave !== dest) {
              FileSystem.deleteAsync(fileToSave, { idempotent: true }).catch(() => {});
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert("Saved to Gallery ✓", "The clip has been saved to your Photos/Videos with a watermark.");
            return;
          } catch {
            // saveToLibraryAsync failed for a non-permission reason (e.g. codec issue).
            // The file is still in app storage — tell the driver clearly.
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert(
              "Couldn't save to gallery",
              "The clip was downloaded to the app but couldn't be added to your Photos. Try sharing it instead.",
            );
            return;
          }
        }

        // Permission was denied or still undetermined after the dialog — give
        // the driver a clear explanation and a direct path to fix it.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "Photos access needed",
          "Msafiri needs permission to save videos to your gallery. Tap Open Settings, then enable Photos access.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings(),
            },
          ],
        );
        return;
      }

      // Web — no MediaLibrary available, clip stays in app document storage
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Downloaded ✓",
        "Clip saved to the app.",
      );
    } catch {
      Alert.alert("Error", "Download failed. Check your connection.");
    } finally {
      setDownloadProgress((prev) => { const n = { ...prev }; delete n[clip.id]; return n; });
    }
  }, [downloadProgress, getSignedUrl, buildPlayerMeta]);


  // ── Share local file helper (extracted so it's reusable) ──────────────────
  const shareLocalFile = useCallback(async (clip: UnifiedClip) => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(clip.uri!, { mimeType: "video/mp4", dialogTitle: "Share dashcam clip" });
      } else {
        await RNShare.share({
          message: `Msafiri dashcam clip — ${fmtDateTime(clip.startedAt)}`,
          url: clip.uri!,
        });
      }
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (!msg.toLowerCase().includes("cancel")) {
        Alert.alert("Share Failed", "Could not share this clip.");
      }
    }
  }, []);

  // ── Share (from menu) ──────────────────────────────────────────────────────
  const handleShare = useCallback(async (clip: UnifiedClip) => {
    setMenuClip(null);

    // Determine what sharing paths are available for this clip:
    //  • hasLocalFile  — clip lives on-device (can share the file directly)
    //  • serverClipId  — server UUID to use for short-link / signed-URL lookup
    //    - source=server  → clip.id IS the server UUID
    //    - source=local with serverId → clip.serverId is the server UUID
    const hasLocalFile = clip.source === "local" && !!clip.uri;
    const serverClipId = clip.source === "server" ? clip.id : (clip.serverId ?? null);
    const hasServerCopy = !!serverClipId;

    if (hasLocalFile && !hasServerCopy) {
      // Local-only — clip hasn't been uploaded yet.  Give helpful context
      // instead of silently proceeding to a file share or failing.
      const isUploading = clip.uploadStatus === "pending";
      const uploadFailed = clip.uploadStatus === "failed";

      if (isUploading || uploadFailed) {
        Alert.alert(
          isUploading ? "Still Uploading" : "Upload Failed",
          isUploading
            ? "This clip is backing up to the cloud. You can share the video file now, or wait a moment and share the link instead."
            : "This clip couldn't be backed up. You can still share the video file directly.",
          [
            { text: "Share File", onPress: () => shareLocalFile(clip) },
            { text: "Cancel", style: "cancel" as const },
          ],
        );
        return;
      }

      // Not locked / no upload intended — share file directly.
      await shareLocalFile(clip);
      return;
    }

    // Clip has a server copy — offer a branded short link plus either
    // "Share File" (still on device) or "Save to Phone" (server-only).
    try {
      setSharingId(clip.id);
      const shortUrl = await getShareLink(serverClipId!);
      if (!shortUrl) {
        Alert.alert("Share Error", "Could not generate a share link. Check your connection and try again.");
        return;
      }

      Alert.alert(
        "Share clip",
        "How would you like to share this clip?",
        [
          { text: "Share Link", onPress: () => handleShareUrl(shortUrl, clip) },
          hasLocalFile
            ? {
                text: "Share File",
                onPress: () => shareLocalFile(clip),
              }
            : { text: "Save to Phone", onPress: () => handleDownload(clip) },
          { text: "Cancel", style: "cancel" as const },
        ],
      );
    } catch { Alert.alert("Share Error", "Could not prepare share link."); }
    finally { setSharingId(null); }
  }, [getShareLink, handleShareUrl, handleDownload, shareLocalFile]);

  // ── Delete ─────────────────────────────────────────────────────────────────
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
                clearCloudQuotaFull();
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else Alert.alert("Error", "Could not delete clip.");
            } catch { Alert.alert("Error", "Network error."); }
          }
        }},
      ]
    );
  }, [deleteSegment, pushDeviceId, clearCloudQuotaFull]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const totalClips  = unifiedClips.length;
  const lockedCount = unifiedClips.filter((c) => c.locked).length;
  const usedMB      = (storageUsedBytes / 1_048_576).toFixed(0);

  // Cloud clips available for download
  const downloadableClips = useMemo(
    () => serverClips.map((sc): UnifiedClip => ({
      id:         sc.id,
      startedAt:  new Date(sc.startedAt).getTime(),
      durationS:  sc.durationS ?? 0,
      sizeBytes:  sc.sizeBytes ?? 0,
      locked:     true,
      lockReason: sc.lockReason ?? "manual",
      source:     "server",
      lat:        sc.lat ?? undefined,
      lng:        sc.lng ?? undefined,
      speedKmh:   sc.speedKmh ?? undefined,
    })),
    [serverClips]
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <FlatList
        {...FLAT_LIST_PROPS}
        data={listItems}
        keyExtractor={(item) => item.key}
        style={{ backgroundColor: c.background }}
        contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: bottomInset + 40, paddingHorizontal: 16 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 12 }}>

            {/* ── Header ──────────────────────────────────────────────── */}
            <View style={vs.headerRow}>
              <TouchableOpacity onPress={goBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

            {/* ── Vehicle selector ────────────────────────────────────── */}
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
                          <View style={vs.primaryBadge}><Text style={vs.primaryText}>Primary</Text></View>
                        )}
                      </View>
                      {activeVehicle?.odometerKm ? (
                        <Text style={[vs.vehicleMeta, { color: c.mutedForeground }]}>
                          {activeVehicle.odometerKm.toLocaleString()} km
                        </Text>
                      ) : null}
                      {activeVehicle?.plateNumber ? (
                        <Text style={[vs.vehicleMeta, { color: c.mutedForeground }]}>
                          {activeVehicle.plateNumber}
                        </Text>
                      ) : null}
                    </View>
                    {vehicles.length > 1 && <Ionicons name="chevron-down" size={20} color={c.mutedForeground} />}
                  </View>
                </TouchableOpacity>
              </>
            )}

            {/* ── Connection status ────────────────────────────────────── */}
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
                onPress={() => {
                  if (isRecording) openDashcam();
                  else router.push("/pretrip-check" as any);
                }}
              >
                <Text style={[vs.openBtnText, { color: c.primary }]}>
                  {isRecording ? "Open Dashcam" : "Start Driving"}
                </Text>
                <Ionicons name={isRecording ? "open-outline" : "car-sport-outline"} size={13} color={c.primary} />
              </TouchableOpacity>
            </View>

            {/* ── Cloud quota banner ──────────────────────────────────── */}
            {cloudQuotaFull && (
              <View style={[vs.quotaBanner, { backgroundColor: "#EF444414", borderColor: "#EF444440" }]}>
                <Ionicons name="cloud-offline-outline" size={20} color="#EF4444" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[vs.quotaTitle, { color: "#EF4444" }]}>Cloud storage full</Text>
                  <Text style={[vs.quotaSub, { color: "#EF4444CC" }]}>
                    New clips can't back up until you delete old cloud clips. Open the Locked tab to remove old footage.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => { setTab("locked"); setDateFilter("all"); }} style={vs.quotaBtn}>
                  <Text style={vs.quotaBtnText}>Manage</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Quick actions ────────────────────────────────────────── */}
            <View style={vs.actionsGrid}>
              {/* Emergency / Locked */}
              <TouchableOpacity
                style={[vs.actionCell, { backgroundColor: "#EF444414", borderColor: "#EF444430" }]}
                onPress={() => { setTab("locked"); setDateFilter("all"); }}
              >
                <Ionicons name="shield" size={24} color="#EF4444" />
                <Text style={[vs.actionLabel, { color: c.foreground }]}>Emergency</Text>
                <Text style={[vs.actionSub, { color: c.mutedForeground }]}>Locked videos</Text>
              </TouchableOpacity>

              {/* Settings */}
              <TouchableOpacity
                style={[vs.actionCell, { backgroundColor: "#8B5CF614", borderColor: "#8B5CF630" }]}
                onPress={() => router.push("/(tabs)/settings" as any)}
              >
                <Ionicons name="settings-outline" size={24} color="#8B5CF6" />
                <Text style={[vs.actionLabel, { color: c.foreground }]}>Settings</Text>
                <Text style={[vs.actionSub, { color: c.mutedForeground }]}>Dashcam setup</Text>
              </TouchableOpacity>
            </View>

            {/* ── Stats strip ──────────────────────────────────────────── */}
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

            {/* ── Pin slots indicator — shown only when ≥1 pin is in use ── */}
            {pinnedCount > 0 && (
              <View style={[vs.pinSlotBar, {
                backgroundColor: pinLimitReached ? "#F59E0B14" : c.card,
                borderColor:     pinLimitReached ? "#F59E0B40" : c.border,
              }]}>
                <Ionicons
                  name="pin"
                  size={14}
                  color={pinLimitReached ? "#F59E0B" : c.mutedForeground}
                />
                <Text style={[vs.pinSlotText, { color: pinLimitReached ? "#F59E0B" : c.mutedForeground }]}>
                  {pinnedCount} of {MAX_PINS_PER_DEVICE} pins used
                  {pinLimitReached ? " — unpin a clip to save another" : ""}
                </Text>
                {/* Mini progress dots */}
                <View style={vs.pinDots}>
                  {Array.from({ length: MAX_PINS_PER_DEVICE }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        vs.pinDot,
                        {
                          backgroundColor: i < pinnedCount
                            ? (pinLimitReached ? "#F59E0B" : "#3B82F6")
                            : c.border,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* ── Tabs ─────────────────────────────────────────────────── */}
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

            {/* ── Date chips ───────────────────────────────────────────── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 4 }}>
              {(["all", "today", "yesterday", "week"] as DateFilter[]).map((f) => {
                const active = dateFilter === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[vs.chip, { backgroundColor: active ? c.primary : c.card, borderColor: active ? c.primary : c.border }]}
                    onPress={() => setDateFilter(f)}
                  >
                    <Text style={[vs.chipText, { color: active ? "#fff" : c.mutedForeground }]}>
                      {f === "all" ? "All" : f === "today" ? "Today" : f === "yesterday" ? "Yesterday" : "This Week"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {serverLoading && <ActivityIndicator size="small" color={c.primary} style={{ marginLeft: 6 }} />}
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
          const isLoading = loadingId === clip.id || sharingId === clip.id;
          const progress  = downloadProgress[clip.id];
          return (
            <View style={{ marginBottom: 8 }}>
              <ClipRow
                clip={clip}
                locationName={locationNames[clip.id] ?? timeOfDayName(clip.startedAt)}
                loading={isLoading}
                pinLoading={pinPending.has(clip.serverId ?? clip.id)}
                pinLimitReached={pinLimitReached}
                thumbnailUri={thumbnails[clip.id]}
                downloadProgress={progress}
                onPlay={handlePlay}
                onMenu={setMenuClip}
                onPin={handlePin}
              />
            </View>
          );
        }}
      />

      {/* ── Vehicle picker ─────────────────────────────────────────────────── */}
      {showPicker && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
          <Pressable style={vs.overlay} onPress={() => setShowPicker(false)} />
          <View style={[vs.sheet, { backgroundColor: c.card, paddingBottom: bottomInset + 20 }]}>
            <View style={[vs.handle, { backgroundColor: c.border }]} />
            <Text style={[vs.sheetTitle, { color: c.foreground }]}>Select Vehicle</Text>
            {vehicles.map((v) => {
              const nm = [
                getMakeById(v.makeId ?? "")?.name  ?? v.customMakeName,
                getModelById(v.makeId ?? "", v.modelId ?? "")?.name ?? v.customModelName,
              ].filter(Boolean).join(" ") || "Vehicle";
              const active = v.id === activeVehicleId;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[vs.vehicleOpt, { borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primary + "10" : "transparent" }]}
                  onPress={() => { setActiveVehicle(v.id); setShowPicker(false); Haptics.selectionAsync(); }}
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

      {/* ── Download sheet ─────────────────────────────────────────────────── */}
      {showDownloadSheet && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowDownloadSheet(false)}>
          <Pressable style={vs.overlay} onPress={() => setShowDownloadSheet(false)} />
          <View style={[vs.sheet, { backgroundColor: c.card, paddingBottom: bottomInset + 20, maxHeight: "80%" as any }]}>
            <View style={[vs.handle, { backgroundColor: c.border }]} />
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <Text style={[vs.sheetTitle, { color: c.foreground, flex: 1 }]}>Cloud Clips</Text>
              <TouchableOpacity
                onPress={() => { fetchServerClips(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ padding: 4 }}
              >
                {serverLoading
                  ? <ActivityIndicator size="small" color={c.primary} />
                  : <Ionicons name="refresh" size={18} color={c.primary} />
                }
              </TouchableOpacity>
            </View>
            <Text style={[vs.sheetSub, { color: c.mutedForeground }]}>
              {downloadableClips.length === 0 ? "No cloud clips found." : `${downloadableClips.length} clip${downloadableClips.length !== 1 ? "s" : ""} backed up to the cloud.`}
            </Text>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {downloadableClips.length === 0 && !serverLoading && (
                <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
                  <Ionicons name="cloud-outline" size={40} color={c.mutedForeground} />
                  <Text style={{ color: c.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular" }}>
                    Lock a clip while driving to back it up.
                  </Text>
                </View>
              )}
              {downloadableClips.map((clip) => {
                const name = locationNames[clip.id] ?? timeOfDayName(clip.startedAt);
                const prog = downloadProgress[clip.id];
                const isDownloading = prog != null;
                return (
                  <View
                    key={clip.id}
                    style={[vs.dlRow, { borderColor: c.border }]}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[vs.dlName, { color: c.foreground }]} numberOfLines={1}>{name}</Text>
                      <Text style={[vs.dlMeta, { color: c.mutedForeground }]}>
                        {fmtDateTime(clip.startedAt)}  ·  {fmtDuration(clip.durationS)}  ·  {fmtSize(clip.sizeBytes)}
                      </Text>
                      {isDownloading && (
                        <View style={{ marginTop: 4, gap: 3 }}>
                          <View style={{ height: 4, backgroundColor: c.muted, borderRadius: 2, overflow: "hidden" }}>
                            <View style={{ height: "100%", width: `${Math.round(prog * 100)}%` as any, backgroundColor: "#3B82F6", borderRadius: 2 }} />
                          </View>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: "#3B82F6" }}>
                            {Math.round(prog * 100)}% downloaded
                          </Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      style={[vs.dlBtn, {
                        backgroundColor: isDownloading ? "#3B82F620" : "#3B82F614",
                        borderColor: "#3B82F640",
                      }]}
                      onPress={() => handleDownload(clip)}
                      disabled={isDownloading}
                    >
                      {isDownloading
                        ? <ActivityIndicator size="small" color="#3B82F6" />
                        : <Ionicons name="download-outline" size={16} color="#3B82F6" />
                      }
                      <Text style={[vs.dlBtnText, { color: "#3B82F6" }]}>
                        {isDownloading ? "Saving…" : "Download"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* ── Clip context menu ──────────────────────────────────────────────── */}
      {menuClip && (
        <Modal transparent animationType="slide" onRequestClose={() => setMenuClip(null)}>
          <Pressable style={vs.overlay} onPress={() => setMenuClip(null)} />
          <View style={[vs.sheet, { backgroundColor: c.card, paddingBottom: bottomInset + 20 }]}>
            <View style={[vs.handle, { backgroundColor: c.border }]} />
            <Text style={[vs.sheetTitle, { color: c.foreground }]} numberOfLines={1}>
              {locationNames[menuClip.id] ?? timeOfDayName(menuClip.startedAt)}
            </Text>
            <Text style={[vs.sheetSub, { color: c.mutedForeground }]}>
              {fmtDateTime(menuClip.startedAt)}  ·  {fmtSize(menuClip.sizeBytes)}
            </Text>

            {([
              {
                icon: "play-circle-outline" as const,
                label: "Play",
                onPress: () => { const cl = menuClip; setMenuClip(null); handlePlay(cl); },
              },
              {
                icon: sharingId === menuClip.id ? "hourglass-outline" as const : "share-outline" as const,
                label: sharingId === menuClip.id ? "Preparing…" : "Share",
                onPress: () => handleShare(menuClip),
                disabled: sharingId === menuClip.id,
              },
              menuClip.source === "server" ? {
                icon: "download-outline" as const,
                label: downloadProgress[menuClip.id] != null
                  ? `Downloading ${Math.round(downloadProgress[menuClip.id] * 100)}%…`
                  : "Download to Device",
                onPress: () => handleDownload(menuClip),
                disabled: downloadProgress[menuClip.id] != null,
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
              (menuClip.source === "server" || !!menuClip.serverId) ? {
                icon: menuClip.pinned ? ("pin" as const) : ("pin-outline" as const),
                label: menuClip.pinned ? "Unpin Clip" : "Pin Clip (60 days)",
                onPress: () => { const cl = menuClip; setMenuClip(null); handlePin(cl); },
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
                style={[vs.menuOpt, { borderColor: c.border, opacity: opt.disabled ? 0.5 : 1 }]}
                onPress={opt.onPress}
                disabled={opt.disabled}
              >
                <Ionicons name={opt.icon} size={20} color={opt.danger ? "#EF4444" : c.foreground} />
                <Text style={[vs.menuOptText, { color: opt.danger ? "#EF4444" : c.foreground }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Modal>
      )}

      {/* ── Video player ───────────────────────────────────────────────────── */}
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

  clipRow:   { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 10 },
  thumb:     { width: 110, height: 72, borderRadius: 10, overflow: "hidden", position: "relative" },
  thumbBg:   { flex: 1, alignItems: "center", justifyContent: "center" },
  thumbPlay: { position: "absolute", top: "50%" as any, left: "50%" as any, marginTop: -14, marginLeft: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  durBadge:  { position: "absolute", bottom: 5, left: 6, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  durText:   { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  cloudBadge: { position: "absolute", top: 5, right: 5, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  clipTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  clipMeta:  { fontSize: 11, fontFamily: "Inter_400Regular" },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  typeDot:   { width: 5, height: 5, borderRadius: 2.5 },
  typeText:  { fontSize: 11, fontFamily: "Inter_500Medium" },
  pinBtn:    { padding: 6 },
  menuBtn:   { padding: 6 },

  empty:      { alignItems: "center", gap: 12, paddingVertical: 60, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  emptySub:   { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  handle:     { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sheetSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, marginBottom: 10 },

  vehicleOpt:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  vehicleOptName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  vehicleOptSub:  { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  menuOpt:     { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  menuOptText: { fontSize: 15, fontFamily: "Inter_500Medium" },

  quotaBanner:  { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  quotaTitle:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  quotaSub:     { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  quotaBtn:     { backgroundColor: "#EF444422", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start", marginTop: 2 },
  quotaBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#EF4444" },

  pinSlotBar:  { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  pinSlotText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  pinDots:     { flexDirection: "row", gap: 4 },
  pinDot:      { width: 8, height: 8, borderRadius: 4 },

  // Download sheet
  dlRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  dlName:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dlMeta:   { fontSize: 11, fontFamily: "Inter_400Regular" },
  dlBtn:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  dlBtnText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
