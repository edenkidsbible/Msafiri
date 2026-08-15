/**
 * TripReviewCard
 *
 * Shows up to 5 saved-for-review dashcam clips after a trip ends. Each clip
 * has a thumbnail, "Lock & Keep" button, and a "Delete" button. A "Dismiss
 * all" button calls `dismissTripReview()` to delete all review clips and clear
 * the banner.
 *
 * Used in two places:
 *  1. TripSummaryModal — appears inline when there are clips to review
 *  2. drive.tsx pre-trip screen — persists across app restarts until acted on
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useDashcam, type DashcamSegment } from "@/context/DashcamContext";
import { type PlayerConfig } from "@/components/VideoPlayerModal";

// Lazy-load VideoThumbnails — not available on web
let VideoThumbnails: typeof import("expo-video-thumbnails") | null = null;
if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  VideoThumbnails = require("expo-video-thumbnails");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-KE", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

function fmtSize(b: number): string {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

// ─── Single clip row ──────────────────────────────────────────────────────────

function ClipReviewRow({
  seg,
  onLock,
  onDelete,
  onPreview,
}: {
  seg: DashcamSegment;
  onLock: () => void;
  onDelete: () => void;
  onPreview: (config: PlayerConfig) => void;
}) {
  const c = useColors();
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Generate thumbnail from the local file
  useEffect(() => {
    if (!VideoThumbnails || !seg.uri) {
      setThumbLoading(false);
      return;
    }
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(seg.uri, { time: 1000 })
      .then((res) => {
        if (!cancelled && mountedRef.current) setThumbUri(res.uri);
      })
      .catch(() => {/* silently skip — no thumbnail */ })
      .finally(() => {
        if (!cancelled && mountedRef.current) setThumbLoading(false);
      });
    return () => { cancelled = true; };
  }, [seg.uri]);

  // lockSavedClip is synchronous: on success the row unmounts (clip removed
  // from savedForReview); on cap refusal an Alert fires and the row stays
  // interactive. No async spinner needed — just call through.
  const handleLock = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onLock();
  }, [onLock]);

  const handleDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(
      "Delete clip?",
      "This clip will be permanently removed from your device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            onDelete();
          },
        },
      ],
    );
  }, [onDelete]);

  const isDark = c.isDark;

  return (
    <View style={[
      rowStyles.container,
      { backgroundColor: isDark ? "#1A2A1F" : "#F0F7F2", borderColor: isDark ? "#2A3B2E" : "#C8DDD0" },
    ]}>
      {/* Thumbnail — tap to preview */}
      <TouchableOpacity
        style={rowStyles.thumbWrap}
        onPress={() => {
          if (!seg.uri) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPreview({ uri: seg.uri, title: fmtTime(seg.startedAt) });
        }}
        activeOpacity={seg.uri ? 0.75 : 1}
        disabled={!seg.uri}
      >
        {thumbLoading ? (
          <View style={[rowStyles.thumbPlaceholder, { backgroundColor: isDark ? "#1E2D24" : "#D8ECDE" }]}>
            <ActivityIndicator size="small" color={isDark ? "#4CAF50" : "#2E7D32"} />
          </View>
        ) : thumbUri ? (
          <Image source={{ uri: thumbUri }} style={rowStyles.thumb} resizeMode="cover" />
        ) : (
          <View style={[rowStyles.thumbPlaceholder, { backgroundColor: isDark ? "#1E2D24" : "#D8ECDE" }]}>
            <Ionicons name="videocam-outline" size={22} color={isDark ? "#4CAF50" : "#2E7D32"} />
          </View>
        )}
        {/* Play button overlay (only when clip is available) */}
        {seg.uri && !thumbLoading && (
          <View style={rowStyles.playOverlay}>
            <Ionicons name="play" size={14} color="#fff" />
          </View>
        )}
        {/* Duration badge */}
        <View style={rowStyles.durBadge}>
          <Text style={rowStyles.durText}>{fmtDuration(seg.durationS)}</Text>
        </View>
      </TouchableOpacity>

      {/* Info */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[rowStyles.time, { color: c.foreground }]}>
          {fmtTime(seg.startedAt)}
        </Text>
        <Text style={[rowStyles.size, { color: c.mutedForeground }]}>
          {fmtSize(seg.sizeBytes)}
        </Text>

        {/* Action buttons */}
        <View style={rowStyles.actions}>
          {/* Lock is synchronous — no spinner; row unmounts on success */}
          <TouchableOpacity
            style={rowStyles.lockBtn}
            onPress={handleLock}
            activeOpacity={0.75}
          >
            <Ionicons name="lock-closed" size={12} color="#fff" />
            <Text style={rowStyles.lockBtnTxt}>Lock & Keep</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[rowStyles.deleteBtn, { borderColor: isDark ? "#3D1F1F" : "#FBCACA" }, deleting && rowStyles.btnDisabled]}
            onPress={handleDelete}
            disabled={deleting}
            activeOpacity={0.75}
          >
            {deleting
              ? <ActivityIndicator size="small" color="#EF4444" />
              : <Ionicons name="trash-outline" size={13} color="#EF4444" />
            }
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  thumbWrap: {
    width: 72,
    height: 54,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  playOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -12,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  durBadge: {
    position: "absolute",
    bottom: 3,
    right: 3,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  durText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
  },
  time: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  size: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  lockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#22C55E",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  lockBtnTxt: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  deleteBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});

// ─── Main card ────────────────────────────────────────────────────────────────

interface TripReviewCardProps {
  /** When true, show a top separator line (used inside TripSummaryModal). */
  showSeparator?: boolean;
  /**
   * Called when the driver taps a clip thumbnail. The caller is responsible
   * for rendering VideoPlayerModal at a non-nested level so it is never
   * stacked inside another RN Modal (which silently fails on iOS).
   */
  onPreview?: (config: PlayerConfig) => void;
}

export default function TripReviewCard({ showSeparator = false, onPreview }: TripReviewCardProps) {
  const c = useColors();
  const { segments, pendingTripReview, lockSavedClip, deleteSegment, dismissTripReview } =
    useDashcam();

  const [dismissing, setDismissing] = useState(false);

  // Collect up to 5 saved-for-review clips, newest first
  const reviewClips = segments
    .filter((s) => s.savedForReview && !s.locked)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5);

  if (!pendingTripReview || reviewClips.length === 0) return null;

  const isDark = c.isDark;
  const sepColor = isDark ? "#2A3B2E" : "#D4E4D8";

  const handleDismissAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(
      "Dismiss all clips?",
      `This will permanently delete all ${reviewClips.length} saved clip${reviewClips.length === 1 ? "" : "s"} from your device. Clips you want to keep should be locked first.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss All",
          style: "destructive",
          onPress: async () => {
            setDismissing(true);
            try {
              await dismissTripReview();
            } finally {
              setDismissing(false);
            }
          },
        },
      ],
    );
  };

  return (
    <>
      {showSeparator && (
        <View style={[cardStyles.separator, { backgroundColor: sepColor }]} />
      )}

      <View style={cardStyles.header}>
        <View style={[cardStyles.headerIcon, { backgroundColor: "#22C55E20" }]}>
          <Ionicons name="videocam" size={14} color="#22C55E" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.headerTitle, { color: c.foreground }]}>
            Review last trip
          </Text>
          <Text style={[cardStyles.headerSub, { color: c.mutedForeground }]}>
            {reviewClips.length} clip{reviewClips.length === 1 ? "" : "s"} saved · Lock what you want to keep
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleDismissAll}
          disabled={dismissing}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[cardStyles.dismissAllBtn, { borderColor: isDark ? "#3D2020" : "#FECACA" }]}
          activeOpacity={0.7}
        >
          {dismissing
            ? <ActivityIndicator size="small" color="#EF4444" />
            : <Text style={cardStyles.dismissAllTxt}>Dismiss all</Text>
          }
        </TouchableOpacity>
      </View>

      {/* No flex:1 on ScrollView — the banner's maxHeight caps overall height;
          ScrollView expands to its content then becomes scrollable. */}
      <ScrollView
        style={{ marginTop: 2 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {reviewClips.map((seg) => (
          <ClipReviewRow
            key={seg.id}
            seg={seg}
            onLock={() => lockSavedClip(seg.id)}
            onDelete={() => deleteSegment(seg.id)}
            onPreview={onPreview ?? (() => {})}
          />
        ))}
      </ScrollView>
    </>
  );
}

const cardStyles = StyleSheet.create({
  separator: {
    height: 1,
    marginVertical: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  dismissAllBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 30,
    alignItems: "center",
  },
  dismissAllTxt: {
    color: "#EF4444",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});
