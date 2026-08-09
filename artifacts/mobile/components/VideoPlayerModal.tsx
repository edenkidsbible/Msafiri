/**
 * VideoPlayerModal — full-screen video player with custom controls.
 *
 * Extracted from dashcam-videos.tsx so it can be re-used in TripReviewCard
 * (and anywhere else a clip needs to be previewed without navigating away).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Metadata shown as an overlay inside the video player. */
export interface PlayerMeta {
  startedAt: number;
  locationName: string;
  vehicleName: string;
  plate?: string;
  speedKmh?: number;
}

export interface PlayerConfig {
  uri: string;
  title: string;
  meta?: PlayerMeta;
  onShare?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PLAYER_SPEEDS = [0.5, 1, 1.5, 2];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-KE", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `Today, ${fmtTime(ms)}`;
  return (
    d.toLocaleDateString("en-KE", { day: "numeric", month: "short" }) +
    ", " +
    fmtTime(ms)
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VideoPlayerModal({
  config,
  onClose,
}: {
  config: PlayerConfig;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(config.uri, (p) => {
    p.loop = false;
    p.play();
  });
  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [ct, setCt] = useState(0);
  const [dur, setDur] = useState(0);
  const [ctrlVis, setCtrlVis] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [barW, setBarW] = useState(1);
  const [metaVis, setMetaVis] = useState(true);
  const anim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      try {
        const c = player.currentTime;
        const d = player.duration;
        const s = (player as any).status as string | undefined;
        setCt(isNaN(c) ? 0 : c);
        if (d && !isNaN(d) && d > 0) setDur(d);
        setPlaying(player.playing);
        setBuffering(s === "loading" || (!player.playing && c === 0 && d === 0));
      } catch {
        /* not ready */
      }
    }, 250);
    return () => clearInterval(id);
  }, [player]);

  const showCtrl = useCallback(() => {
    setCtrlVis(true);
    Animated.timing(anim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }).start(() =>
        setCtrlVis(false)
      );
    }, 4000);
  }, [anim]);

  useEffect(() => {
    showCtrl();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [showCtrl]);

  const progress = dur > 0 ? Math.min(1, ct / dur) : 0;
  const fT = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
  const { meta } = config;

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {/* Video surface */}
        <VideoView
          player={player as any}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={false}
        />

        {/* Buffering spinner */}
        {buffering && (
          <View
            style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
            pointerEvents="none"
          >
            <View
              style={{ backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 16, padding: 18 }}
            >
              <ActivityIndicator size="large" color="#fff" />
              <Text
                style={{
                  color: "rgba(255,255,255,0.7)",
                  fontSize: 12,
                  marginTop: 8,
                  fontFamily: "Inter_500Medium",
                }}
              >
                Loading…
              </Text>
            </View>
          </View>
        )}

        {/* Tap area to show/hide controls */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (ctrlVis) {
              Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
                () => setCtrlVis(false)
              );
              if (timerRef.current) clearTimeout(timerRef.current);
            } else {
              showCtrl();
            }
          }}
        />

        {/* Top bar — title + share */}
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              flexDirection: "row",
              alignItems: "center",
              paddingTop: insets.top + 8,
              paddingHorizontal: 12,
              paddingBottom: 12,
            },
            { opacity: anim },
          ]}
          pointerEvents={ctrlVis ? "box-none" : "none"}
        >
          <TouchableOpacity onPress={onClose} style={pls.topBtn}>
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={pls.topTitle} numberOfLines={1}>
            {config.title}
          </Text>
          {config.onShare ? (
            <TouchableOpacity onPress={config.onShare} style={pls.topBtn}>
              <Ionicons name="share-outline" size={22} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </Animated.View>

        {/* Metadata overlay — always visible, toggled by tapping the badge */}
        {meta && (
          <TouchableOpacity
            style={pls.metaBadge}
            onPress={() => setMetaVis((v) => !v)}
            activeOpacity={0.8}
          >
            <Ionicons
              name="information-circle"
              size={14}
              color={metaVis ? "#22c55e" : "rgba(255,255,255,0.5)"}
            />
          </TouchableOpacity>
        )}
        {meta && metaVis && (
          <View style={pls.metaPanel} pointerEvents="none">
            <Text style={pls.metaLine}>📍 {meta.locationName}</Text>
            <Text style={pls.metaLine}>🗓 {fmtDateTime(meta.startedAt)}</Text>
            <Text style={pls.metaLine}>
              🚗 {meta.vehicleName}
              {meta.plate ? ` · ${meta.plate}` : ""}
            </Text>
            {meta.speedKmh != null && (
              <Text style={pls.metaLine}>💨 {Math.round(meta.speedKmh)} km/h at start</Text>
            )}
          </View>
        )}

        {/* Bottom controls */}
        <Animated.View
          style={{ opacity: anim }}
          pointerEvents={ctrlVis ? "box-none" : "none"}
        >
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.92)"]}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              paddingTop: 60,
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + 20,
            }}
          >
            {/* Seek bar */}
            <View
              style={{ marginBottom: 16 }}
              onLayout={(e) => setBarW(Math.max(1, e.nativeEvent.layout.width))}
            >
              <Pressable
                style={{ height: 20, justifyContent: "center" }}
                onPress={(e) => {
                  player.currentTime = (e.nativeEvent.locationX / barW) * dur;
                }}
              >
                <View
                  style={{
                    height: 3,
                    backgroundColor: "rgba(255,255,255,0.3)",
                    borderRadius: 1.5,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      height: "100%" as any,
                      width: `${progress * 100}%` as any,
                      backgroundColor: "#22c55e",
                      borderRadius: 1.5,
                    }}
                  />
                </View>
                <View
                  style={{
                    position: "absolute",
                    top: "50%" as any,
                    left: progress * (barW - 12),
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: "#fff",
                    marginTop: -6,
                  }}
                />
              </Pressable>
              <View
                style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}
              >
                <Text
                  style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular" }}
                >
                  {fT(ct)}
                </Text>
                <Text
                  style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Inter_400Regular" }}
                >
                  {fT(dur)}
                </Text>
              </View>
            </View>

            {/* Transport controls */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              {/* Speed toggle */}
              <TouchableOpacity
                onPress={() => {
                  const n = (speedIdx + 1) % PLAYER_SPEEDS.length;
                  setSpeedIdx(n);
                  player.playbackRate = PLAYER_SPEEDS[n];
                }}
                style={pls.speedBtn}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
                  {PLAYER_SPEEDS[speedIdx]}×
                </Text>
              </TouchableOpacity>

              {/* −15 s */}
              <TouchableOpacity
                onPress={() => {
                  player.currentTime = Math.max(0, ct - 15);
                }}
                style={pls.skipBtn}
              >
                <Ionicons name="play-back-outline" size={28} color="#fff" />
                <Text style={pls.skipLabel}>15</Text>
              </TouchableOpacity>

              {/* Play / Pause */}
              <TouchableOpacity
                onPress={() => {
                  if (player.playing) player.pause();
                  else player.play();
                }}
                style={pls.playBtn}
              >
                {buffering ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Ionicons name={playing ? "pause" : "play"} size={28} color="#000" />
                )}
              </TouchableOpacity>

              {/* +15 s */}
              <TouchableOpacity
                onPress={() => {
                  player.currentTime = Math.min(dur, ct + 15);
                }}
                style={pls.skipBtn}
              >
                <Ionicons name="play-forward-outline" size={28} color="#fff" />
                <Text style={pls.skipLabel}>15</Text>
              </TouchableOpacity>

              <View style={{ width: 52 }} />
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Player-local styles ─────────────────────────────────────────────────────

const pls = StyleSheet.create({
  topBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  speedBtn: {
    width: 52,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  skipBtn: { width: 60, height: 60, alignItems: "center", justifyContent: "center" },
  skipLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    marginTop: -6,
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  metaBadge: {
    position: "absolute",
    top: 100,
    right: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 12,
    padding: 6,
  },
  metaPanel: {
    position: "absolute",
    top: 124,
    right: 14,
    backgroundColor: "rgba(0,0,0,0.68)",
    borderRadius: 10,
    padding: 10,
    gap: 3,
    maxWidth: 220,
  },
  metaLine: { color: "#fff", fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 17 },
});
