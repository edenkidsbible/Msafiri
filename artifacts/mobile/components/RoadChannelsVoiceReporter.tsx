import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import {
  createAudioPlayer,
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioPlayer,
} from "expo-audio";
import { getInfoAsync } from "expo-file-system/legacy";
import { requestAndroidMicrophonePermission } from "@/utils/androidCameraPermissions";
import { restoreAudioMode } from "@/utils/sound";
import { getNearbyRoadNames } from "@/utils/snapToRoad";

import { useColors } from "@/hooks/useColors";
import {
  confirmVoiceReport,
  discoverRoadChannels,
  getRoadChannelFeed,
  interpretVoiceReport,
  requestVoiceUpload,
  leaveRoadChannel,
  setRoadChannelMuted,
  updateRoadChannelPresence,
  uploadVoiceRecording,
  type RoadChannel,
  type RoadChannelCategory,
  type RoadChannelFeedItem,
  type RoadChannelLocation,
  type VoiceInterpretation,
  ROAD_CHANNEL_CATEGORIES,
} from "@/utils/roadChannelsApi";

const MAX_SECONDS = 15;
const MIN_USEFUL_SECONDS = 2;
const ON_ROAD_DISTANCE_M = 250;
const VOICE_CONTENT_TYPE = "audio/mp4";

export interface RoadChannelsVoiceReporterProps {
  /** Pass the driver's current position when available. */
  location?: RoadChannelLocation | null;
  deviceId?: string;
  roadName?: string | null;
  heading?: number | null;
  dashcamRecording?: boolean;
  dashcamAudioEnabled?: boolean;
  /** Reports can only be created while an explicit drive is active. */
  activeDrive?: boolean;
  pauseDashcamForVoice?: () => Promise<boolean>;
  resumeDashcamAfterVoice?: (shouldResume: boolean) => Promise<void>;
  /** Lets a parent surface a successful confirmed report without coupling to AppContext. */
  onConfirmed?: (reportId: string, interpretation: VoiceInterpretation) => void;
  onCancelled?: () => void;
  onLeave?: () => void;
}

const GUIDELINES_KEY = "@msafiri/road-channels-guidelines-v1";
const CATEGORY_LABELS: Record<RoadChannelCategory, string> = {
  traffic: "Traffic", accident: "Accident", police_checkpoint: "Police checkpoint",
  roadworks: "Roadworks", hazard: "Hazard", speed_camera: "Speed camera",
  flooding: "Flooding", breakdown: "Breakdown",
};

function timeLabel(milliseconds: number): string {
  const seconds = Math.min(MAX_SECONDS, Math.floor(milliseconds / 1000));
  return `0:${seconds.toString().padStart(2, "0")}`;
}

async function resolveVoiceLocation(
  supplied: RoadChannelLocation | null | undefined,
): Promise<RoadChannelLocation | null> {
  if (supplied) return supplied;

  const permission = await Location.getForegroundPermissionsAsync();
  const status = permission.status === "granted"
    ? permission.status
    : (await Location.requestForegroundPermissionsAsync()).status;
  if (status !== "granted") return null;

  // Prefer a fresh fix so a report is pinned to where the driver is now.
  let fresh: Location.LocationObject | null = null;
  try {
    fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
  } catch {
    fresh = null;
  }
  if (fresh) {
    return { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
  }

  // A short-lived GPS stall should not block a report when the OS has a
  // recent fix available.
  try {
    const cached = await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60_000,
      requiredAccuracy: 1_000,
    });
    if (cached) return { latitude: cached.coords.latitude, longitude: cached.coords.longitude };
  } catch {
    // The caller presents the actionable location-services message.
  }
  return null;
}

/**
 * A standalone, confirmation-gated voice reporting control. It can publish
 * through a live Road Channel when one is nearby, or stage a normal community
 * report when the current road has no channel yet.
 */
export default function RoadChannelsVoiceReporter({
  location = null,
  deviceId,
  roadName,
  heading = null,
  dashcamRecording = false,
  dashcamAudioEnabled = false,
  activeDrive = false,
  pauseDashcamForVoice,
  resumeDashcamAfterVoice,
  onConfirmed,
  onCancelled,
  onLeave,
}: RoadChannelsVoiceReporterProps) {
  const c = useColors();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 200);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendCountdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendCountdownRef = useRef(0);
  const startInFlightRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const pressHeldRef = useRef(false);
  const startGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const voiceAudioModeActiveRef = useRef(false);
  const dashcamPausedRef = useRef(false);
  const voiceLeaseHeldRef = useRef(false);
  const resumeDashcamRef = useRef(resumeDashcamAfterVoice);
  useEffect(() => { resumeDashcamRef.current = resumeDashcamAfterVoice; }, [resumeDashcamAfterVoice]);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [sendCountdown, setSendCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<VoiceInterpretation | null>(null);
  const [channel, setChannel] = useState<RoadChannel | null>(null);
  const [availableChannels, setAvailableChannels] = useState<RoadChannel[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<"loading" | "available" | "unavailable">("loading");
  const [category, setCategory] = useState<RoadChannelCategory>("traffic");
  const [guidelinesAccepted, setGuidelinesAccepted] = useState(false);
  const [guidelinesLoaded, setGuidelinesLoaded] = useState(false);
  const [feed, setFeed] = useState<RoadChannelFeedItem[]>([]);
  const [, setFeedCursor] = useState<string | null>(null);
  const feedCursorRef = useRef<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<"loading" | "ready" | "reconnecting">("loading");
  const [listenerMuted, setListenerMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const feedPlayerRef = useRef<AudioPlayer | null>(null);
  const channelRef = useRef<RoadChannel | null>(null);
  const reportLocationRef = useRef<RoadChannelLocation | null>(null);
  const handoffCandidateRef = useRef<{ id: string; count: number } | null>(null);
  const discoveryResolvedRef = useRef(false);
  const [automaticSwitching, setAutomaticSwitching] = useState(false);
  useEffect(() => { channelRef.current = channel; }, [channel]);
  // Raw GPS and compass values update every second. Bucket discovery so an
  // in-flight road lookup is not cancelled by the next location fix.
  const discoveryLat = location ? Math.round(location.latitude * 1_000) / 1_000 : null;
  const discoveryLng = location ? Math.round(location.longitude * 1_000) / 1_000 : null;
  const discoveryHeading = heading == null ? null : Math.round(heading / 30) * 30 % 360;
  const reportingChannel = availableChannels.find(
    (item) => item.distanceM != null && item.distanceM <= ON_ROAD_DISTANCE_M,
  ) ?? null;

  const clearStopTimer = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };

  const clearSendCountdown = (updateState = true) => {
    if (sendCountdownTimer.current) clearInterval(sendCountdownTimer.current);
    sendCountdownTimer.current = null;
    sendCountdownRef.current = 0;
    if (updateState) setSendCountdown(null);
  };

  const resumeDashcamIfNeeded = async () => {
    if (!voiceLeaseHeldRef.current) return;
    voiceLeaseHeldRef.current = false;
    const shouldResume = dashcamPausedRef.current;
    dashcamPausedRef.current = false;
    await resumeDashcamRef.current?.(shouldResume);
  };

  const restoreVoiceAudioMode = async () => {
    if (!voiceAudioModeActiveRef.current) return;
    voiceAudioModeActiveRef.current = false;
    await restoreAudioMode();
  };

  const confirmDashcamHandoff = (): Promise<boolean> => {
    if (!dashcamRecording) return Promise.resolve(true);
    return new Promise((resolve) => {
      Alert.alert(
        "Pause dashcam briefly?",
        dashcamAudioEnabled
          ? "Road Channels needs the microphone. Msafiri will save the current dashcam segment, pause video and audio for up to 15 seconds, then resume the dashcam automatically."
          : "Msafiri will save the current dashcam segment, pause video briefly while you speak, then resume the dashcam automatically.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Pause & Speak", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  };

  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    const key = `${GUIDELINES_KEY}:${deviceId ?? "anonymous"}`;
    AsyncStorage.getItem(key)
      .then((value) => { if (active) setGuidelinesAccepted(value === "accepted"); })
      .catch(() => { if (active) setMessage("Could not load Road Channels preferences."); })
      .finally(() => { if (active) setGuidelinesLoaded(true); });
    return () => { active = false; };
  }, [deviceId]);

  // Discovery is read-only. Presence begins only after an explicit Join tap.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (discoveryLat == null || discoveryLng == null) {
      setChannel(null);
      setAvailableChannels([]);
      setDiscoveryStatus("unavailable");
      discoveryResolvedRef.current = true;
      return;
    }
    let active = true;
    if (!discoveryResolvedRef.current) setDiscoveryStatus("loading");
    Promise.race<string[]>([
      getNearbyRoadNames(discoveryLat, discoveryLng)
        .then((roads) => [...(roadName ? [roadName] : []), ...roads]),
      new Promise<string[]>((resolve) => setTimeout(() => resolve(roadName ? [roadName] : []), 6000)),
    ])
      .then((roads) => discoverRoadChannels(
        [...new Set(roads)],
        discoveryHeading,
        { latitude: discoveryLat, longitude: discoveryLng },
        5_000,
      ))
      .then(async ({ channels }) => {
        if (!active) return;
        const nearest = channels[0] ?? null;
        setAvailableChannels(channels);
        const current = channelRef.current;
        if (!nearest || !current || nearest.id === current.id) {
          handoffCandidateRef.current = null;
          setChannel(nearest);
        } else {
          const previous = handoffCandidateRef.current;
          const count = previous?.id === nearest.id ? previous.count + 1 : 1;
          handoffCandidateRef.current = { id: nearest.id, count };
          if (count >= 2) {
            handoffCandidateRef.current = null;
            if (automaticSwitching) {
              setChannel(nearest);
            } else {
              Alert.alert(
                "Road Channel changed",
                `Msafiri found ${nearest.name}. Switch from ${current.name}?`,
                [
                  { text: "Stay", style: "cancel" },
                  { text: "Switch", onPress: () => setChannel(nearest) },
                ],
              );
            }
          }
        }
        setDiscoveryStatus(nearest ? "available" : "unavailable");
        discoveryResolvedRef.current = true;
      })
      .catch((error) => {
        if (!active) return;
        if (!channelRef.current) {
          setChannel(null);
          setAvailableChannels([]);
          setDiscoveryStatus("unavailable");
        }
        discoveryResolvedRef.current = true;
        setMessage(error instanceof Error ? error.message : "Could not look up nearby Road Channels.");
      });
    return () => { active = false; };
  }, [deviceId, discoveryLat, discoveryLng, roadName, automaticSwitching]);

  // Presence is a short lease, refreshed only while the driver is actively
  // listening. Exact coordinates remain server-private and are never in feeds.
  useEffect(() => {
    if (!listening || !activeDrive || !channel || !deviceId || !location) return;
    const heartbeat = () => {
      void updateRoadChannelPresence({ deviceId, location, channelId: channel.id })
        .catch(() => setFeedStatus("reconnecting"));
    };
    heartbeat();
    const timer = setInterval(heartbeat, 60_000);
    return () => clearInterval(timer);
  }, [listening, activeDrive, channel?.id, deviceId, location?.latitude, location?.longitude]);

  // Rehydrate the listener queue after each poll. If a deployment rejects a
  // stale cursor, retry from the newest feed rather than leaving the driver in
  // a permanently reconnecting state.
  useEffect(() => {
    if (Platform.OS === "web" || !channel || !deviceId || !activeDrive || !listening) return;
    let active = true;
    const refresh = async (recover = false) => {
      setFeedStatus(recover ? "reconnecting" : "loading");
      try {
        const result = await getRoadChannelFeed(channel.id, deviceId, recover ? null : feedCursorRef.current);
        if (!active) return;
        setFeed((previous) => {
          const seen = new Set(previous.map((item) => item.id));
          const incoming = result.items.filter((item) => !seen.has(item.id));
          return [...incoming, ...previous].slice(0, 20);
        });
        setFeedCursor(result.cursor);
        feedCursorRef.current = result.cursor;
        setFeedStatus("ready");
      } catch {
        if (!recover) {
          await refresh(true);
        } else if (active) {
          setFeedStatus("reconnecting");
        }
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 20_000);
    return () => { active = false; clearInterval(timer); };
  }, [channel?.id, deviceId, activeDrive, listening]);

  const playFeedItem = async (item: RoadChannelFeedItem) => {
    if (!item.audioUrl || listenerMuted) return;
    try {
      feedPlayerRef.current?.pause();
      await restoreAudioMode();
      const player = createAudioPlayer({ uri: item.audioUrl });
      feedPlayerRef.current = player;
      player.volume = 0.7;
      player.play();
    } catch {
      setMessage("Could not play this road update.");
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startGenerationRef.current += 1;
      pressHeldRef.current = false;
      clearStopTimer();
      clearSendCountdown(false);
      // useAudioRecorder owns native recorder disposal on unmount. Never read
      // or call that shared object here because Expo may already have released
      // it before this cleanup executes.
      recordingActiveRef.current = false;
      try { feedPlayerRef.current?.pause(); } catch {}
      void restoreVoiceAudioMode()
        .catch(() => {})
        .finally(() => { void resumeDashcamIfNeeded(); });
    };
  }, []);

  const startAutoSendCountdown = (uri: string) => {
    clearSendCountdown();
    sendCountdownRef.current = 3;
    setSendCountdown(3);
    setMessage("Sending privately in 3 seconds…");
    sendCountdownTimer.current = setInterval(() => {
      const next = sendCountdownRef.current - 1;
      sendCountdownRef.current = next;
      if (next <= 0) {
        clearSendCountdown();
        void interpret(uri);
      } else {
        setSendCountdown(next);
        setMessage(`Sending privately in ${next} second${next === 1 ? "" : "s"}…`);
      }
    }, 1_000);
  };

  const stopRecording = async () => {
    clearStopTimer();
    if (!recordingActiveRef.current) return;
    recordingActiveRef.current = false;
    try {
      // Read from the recorder, rather than hook state captured by an auto-stop
      // timeout, so the minimum-duration check remains correct at 15 seconds.
      const durationMillis = recorder.getStatus().durationMillis;
      try {
        await recorder.stop();
      } finally {
        await restoreVoiceAudioMode().catch(() => {});
        await resumeDashcamIfNeeded();
      }
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording could not be saved.");
      if (durationMillis < MIN_USEFUL_SECONDS * 1000) {
        setMessage(`Hold for at least ${MIN_USEFUL_SECONDS} seconds so we can understand the report.`);
        return;
      }
      setRecordedUri(uri);
      startAutoSendCountdown(uri);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop recording.");
    }
  };

  const startRecording = async () => {
    if (startInFlightRef.current || recordingActiveRef.current) return;
    if (!activeDrive) {
      setMessage("Start a drive before sending a Road Channels update.");
      return;
    }
    if (Platform.OS === "web") {
      setMessage("Voice reporting is available in the Msafiri mobile app.");
      return;
    }
    if (!deviceId) {
      setMessage("Preparing your device for voice reporting. Please try again.");
      return;
    }
    setMessage(null);
    setInterpretation(null);
    setRecordedUri(null);
    startInFlightRef.current = true;
    const generation = ++startGenerationRef.current;
    const cancelled = () => !mountedRef.current || generation !== startGenerationRef.current;
    const abortCancelledStart = async () => {
      if (recordingActiveRef.current) {
        recordingActiveRef.current = false;
        await recorder.stop().catch(() => {});
      }
      await restoreVoiceAudioMode().catch(() => {});
      await resumeDashcamIfNeeded().catch(() => {});
    };
    try {
      const resolvedLocation = await resolveVoiceLocation(location);
      if (cancelled()) return void await abortCancelledStart();
      if (!resolvedLocation) {
        setMessage("We could not detect your location. Turn on Location Services and try again.");
        return;
      }
      reportLocationRef.current = resolvedLocation;
      // Selecting a nearby channel is a listening choice only. The report
      // target is resolved independently from GPS distance during upload, so
      // recording never silently joins or publishes onto a road kilometres
      // away from the driver.
      const permission = Platform.OS === "android"
        ? {
            granted: await requestAndroidMicrophonePermission(),
            canAskAgain: true,
          }
        : await (async () => {
            const current = await getRecordingPermissionsAsync();
            return current.granted ? current : requestRecordingPermissionsAsync();
          })();
      if (cancelled()) return void await abortCancelledStart();
      if (!permission.granted) {
        const detail = "Enable Microphone for Msafiri in Settings to report by voice.";
        setMessage(detail);
        Alert.alert("Microphone unavailable", detail, [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => {}) },
        ]);
        return;
      }
      if (!(await confirmDashcamHandoff())) return;
      if (cancelled()) return void await abortCancelledStart();
      if (!pauseDashcamForVoice) throw new Error("Microphone handoff is unavailable. Nothing was recorded.");
      {
        setMessage("Saving the current dashcam segment…");
        dashcamPausedRef.current = await pauseDashcamForVoice();
        voiceLeaseHeldRef.current = true;
        if (cancelled()) return void await abortCancelledStart();
        setMessage(null);
      }
      voiceAudioModeActiveRef.current = true;
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      if (cancelled()) return void await abortCancelledStart();
      await recorder.prepareToRecordAsync();
      if (cancelled()) return void await abortCancelledStart();
      recorder.record();
      recordingActiveRef.current = true;
      if (!pressHeldRef.current) {
        await stopRecording();
        return;
      }
      stopTimer.current = setTimeout(() => { void stopRecording(); }, MAX_SECONDS * 1000);
    } catch (error) {
      await restoreVoiceAudioMode().catch(() => {});
      await resumeDashcamIfNeeded().catch(() => {});
      if (mountedRef.current) {
        setMessage(error instanceof Error ? error.message : "Could not start recording.");
      }
    } finally {
      startInFlightRef.current = false;
    }
  };

  const interpret = async (uriOverride?: string) => {
    const uri = uriOverride ?? recordedUri;
    if (!uri) return;
    clearSendCountdown();
    setBusy(true);
    setMessage("Preparing private upload…");
    try {
      const context = {
        deviceId,
        location: reportLocationRef.current ?? location ?? undefined,
        channelId: reportingChannel?.id,
        roadName,
      };
      const fileInfo = await getInfoAsync(uri);
      if (!fileInfo.exists || !fileInfo.size) throw new Error("The voice recording could not be read.");
      const request = await requestVoiceUpload(context, {
        contentType: VOICE_CONTENT_TYPE,
        sizeBytes: fileInfo.size,
      });
      setMessage("Uploading voice report…");
      await uploadVoiceRecording(request, uri, VOICE_CONTENT_TYPE);
      setMessage("Understanding your report…");
      const result = await interpretVoiceReport(request.voiceReportId, context);
      setInterpretation(result);
      setMessage(null);
    } catch (error) {
      setRecordedUri(null);
      reportLocationRef.current = null;
      setMessage(error instanceof Error ? error.message : "We could not interpret that report. Please re-record.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!interpretation) return;
    if (!activeDrive) {
      setMessage("This drive has ended. Nothing was published.");
      return;
    }
    if (!guidelinesAccepted) {
      setMessage("Accept the community guidelines before your first contribution.");
      return;
    }
    setBusy(true);
    try {
      const result = await confirmVoiceReport(interpretation, {
        deviceId,
        location: reportLocationRef.current ?? location ?? undefined,
        channelId: reportingChannel?.id,
      }, { selectedCategory: category, communityGuidelinesAccepted: true });
      await AsyncStorage.setItem(`${GUIDELINES_KEY}:${deviceId ?? "anonymous"}`, "accepted");
        setMessage(reportingChannel ? `Report shared with ${reportingChannel.name}.` : "Report shared for your current location.");
      onConfirmed?.(result.reportId, interpretation);
      setInterpretation(null);
      setRecordedUri(null);
      reportLocationRef.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm the report. Nothing was published.");
    } finally {
      setBusy(false);
    }
  };

  const rerecord = () => {
    clearSendCountdown();
    setRecordedUri(null);
    setInterpretation(null);
    setMessage(null);
    reportLocationRef.current = null;
  };

  const cancel = () => {
    clearStopTimer();
    clearSendCountdown();
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false;
      void recorder.stop().finally(() => {
        void restoreVoiceAudioMode()
          .catch(() => {})
          .finally(() => { void resumeDashcamIfNeeded(); });
      });
    } else {
      void resumeDashcamIfNeeded();
    }
    rerecord();
    onCancelled?.();
  };

  const cancelPendingSend = () => {
    clearSendCountdown();
    setRecordedUri(null);
    setInterpretation(null);
    reportLocationRef.current = null;
    setMessage("Send cancelled. Hold to record again.");
  };

  const isRecording = recording.isRecording;
  const actionLabel = isRecording ? "Release to send" : recordedUri ? "Sending…" : "Hold to record";
  // Voice reports are useful even when no live Road Channel is nearby. Keep
  // the action available throughout an active drive; recording itself will
  // explain a missing GPS/device prerequisite instead of making the mic look
  // mysteriously disabled while discovery or permissions are still settling.
  const canReport = activeDrive;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>ROAD CHANNELS</Text>
      <Text style={[styles.title, { color: c.foreground }]}>Report by voice</Text>
      <Text style={[styles.helper, { color: c.mutedForeground }]}>
          {!activeDrive
            ? "Start an active drive to listen or report."
            : discoveryStatus === "loading"
           ? "Finding your road…"
            : reportingChannel?.name
              ? `Reports use ${reportingChannel.road ?? reportingChannel.name} at your current location.`
              : channel?.name
                ? `Listening to ${channel.name}. Reports use your current location.`
                : "No live Road Channel nearby. You can still report an incident for this road."}
      </Text>
       {activeDrive && channel ? (
         <View style={[styles.listenCard, { backgroundColor: c.secondary, borderColor: c.border }]}>
           <View style={styles.listenHeader}>
             <View style={{ flex: 1 }}>
               <Text style={[styles.listenTitle, { color: c.foreground }]}>Listen first</Text>
               <Text style={[styles.listenCopy, { color: c.mutedForeground }]}>
                 {feedStatus === "reconnecting" ? "Reconnecting to live updates…" : feed.length ? `${feed.length} recent channel update${feed.length === 1 ? "" : "s"}` : "No recent updates — you are first to listen."}
               </Text>
             </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={listenerMuted ? "Unmute Road Channel" : "Mute Road Channel"} onPress={() => {
                const next = !listenerMuted;
                setListenerMuted(next);
                if (next) feedPlayerRef.current?.pause();
                if (deviceId) void setRoadChannelMuted(channel.id, deviceId, next).catch(() => {});
              }} style={[styles.listenerControl, { borderColor: c.border }]}>
               <Ionicons name={listenerMuted ? "volume-mute-outline" : "volume-high-outline"} size={18} color={c.foreground} />
             </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={listening ? "Leave Road Channel" : "Join Road Channel"} onPress={() => {
                if (!deviceId || !location) return;
                if (listening) {
                  setListening(false);
                  setFeed([]);
                  feedCursorRef.current = null;
                  void leaveRoadChannel(channel.id, deviceId).catch(() => {});
                  onLeave?.();
                } else {
                  setListening(true);
                  void updateRoadChannelPresence({ deviceId, location, channelId: channel.id });
                }
              }} style={[styles.listenerControl, { borderColor: c.border }]}>
                <Ionicons name={listening ? "exit-outline" : "radio-outline"} size={18} color={c.foreground} />
             </TouchableOpacity>
           </View>
            <Text style={[styles.listenCopy, { color: c.mutedForeground }]}>
              {channel.direction && channel.direction !== "unknown" ? `${channel.direction} · ` : ""}
              about {channel.memberCount ?? 0} listener{channel.memberCount === 1 ? "" : "s"}
            </Text>
            <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: automaticSwitching }} onPress={() => setAutomaticSwitching((value) => !value)} style={styles.autoSwitchRow}>
              <Ionicons name={automaticSwitching ? "checkbox" : "square-outline"} size={17} color={c.primary} />
              <Text style={[styles.listenCopy, { color: c.mutedForeground }]}>Automatically switch after a stable road change</Text>
            </TouchableOpacity>
            {!listening ? <Text style={[styles.feedItem, { color: c.primary }]}>Tap the radio button to join.</Text> : null}
            {feed.slice(0, 3).map((item) => (
              <TouchableOpacity key={item.id} accessibilityRole="button" disabled={!item.audioUrl || listenerMuted} onPress={() => { void playFeedItem(item); }} style={styles.feedRow}>
                <Ionicons name="play-circle" size={18} color={item.audioUrl && !listenerMuted ? c.primary : c.mutedForeground} />
                <Text style={[styles.feedItem, { color: c.mutedForeground }]} numberOfLines={2}>
                  {item.summary ?? `${item.type.replace(/_/g, " ")} · ${new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </Text>
              </TouchableOpacity>
           ))}
         </View>
       ) : null}

       {activeDrive && (availableChannels.length > 1 || availableChannels[0]?.nearby) ? (
         <View style={styles.nearbySection}>
           <Text style={[styles.categoryHeading, { color: c.foreground }]}>Nearby Road Channels</Text>
           <Text style={[styles.categoryHint, { color: c.mutedForeground }]}>
              Join nearby channels to listen. Reports always use the road or location you are currently driving on.
           </Text>
           <View style={styles.categoryGrid}>
             {availableChannels.map((item) => (
               <TouchableOpacity
                 key={item.id}
                 accessibilityRole="button"
                 accessibilityState={{ selected: channel?.id === item.id }}
                 onPress={() => setChannel(item)}
                 style={[styles.categoryChip, {
                   borderColor: channel?.id === item.id ? c.primary : c.border,
                   backgroundColor: channel?.id === item.id ? c.primary + "18" : c.card,
                 }]}
               >
                 <Text style={[styles.categoryLabel, { color: channel?.id === item.id ? c.primary : c.foreground }]}>
                    {item.road ?? item.name}
                    {item.distanceM != null
                      ? item.distanceM <= ON_ROAD_DISTANCE_M
                        ? " · On this road · Report + listen"
                        : ` · ${(item.distanceM / 1000).toFixed(1)} km · Listen only`
                      : ""}
                 </Text>
               </TouchableOpacity>
             ))}
           </View>
         </View>
       ) : null}

       <View style={styles.categorySection}>
         <Text style={[styles.categoryHeading, { color: c.foreground }]}>What are you reporting?</Text>
          <Text style={[styles.categoryHint, { color: c.mutedForeground }]}>
            Choose a category so the community gets useful context.
          </Text>
         <View style={styles.categoryGrid}>
           {ROAD_CHANNEL_CATEGORIES.map((item) => (
             <TouchableOpacity key={item} accessibilityRole="button" accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} style={[styles.categoryChip, { borderColor: category === item ? c.primary : c.border, backgroundColor: category === item ? c.primary + "18" : c.card }]}>
               <Text style={[styles.categoryLabel, { color: category === item ? c.primary : c.foreground }]}>{CATEGORY_LABELS[item]}</Text>
             </TouchableOpacity>
           ))}
         </View>
       </View>

      {isRecording && <Text style={[styles.timer, { color: c.destructive }]} accessibilityLiveRegion="polite">{timeLabel(recording.durationMillis)} / 0:15</Text>}

      {interpretation ? (
        <View style={[styles.result, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <Text style={[styles.resultTitle, { color: c.foreground }]}>Check before sharing</Text>
           <Text style={[styles.resultText, { color: c.foreground }]}>
              {CATEGORY_LABELS[category]} · {interpretation.road ?? "Road not recognised"}
           </Text>
            {interpretation.proposedType && interpretation.proposedType !== category && <Text style={[styles.detail, { color: c.mutedForeground }]}>Confirmed as: {interpretation.proposedType.replace(/_/g, " ")}</Text>}
           {interpretation.summary ? <Text style={[styles.summary, { color: c.foreground }]}>{interpretation.summary}</Text> : null}
          <Text style={[styles.transcript, { color: c.mutedForeground }]}>{interpretation.transcript}</Text>
          {interpretation.speedLimit != null && <Text style={[styles.detail, { color: c.mutedForeground }]}>Speed limit: {interpretation.speedLimit} km/h</Text>}
          {interpretation.cameraType && <Text style={[styles.detail, { color: c.mutedForeground }]}>Camera: {interpretation.cameraType}</Text>}
           {!guidelinesLoaded ? <Text style={[styles.detail, { color: c.mutedForeground }]}>Loading contribution preferences…</Text> : !guidelinesAccepted ? (
             <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: guidelinesAccepted }} onPress={() => setGuidelinesAccepted(true)} style={styles.guidelines}>
               <Ionicons name="square-outline" size={20} color={c.primary} />
               <Text style={[styles.guidelinesText, { color: c.mutedForeground }]}>I agree to share accurate, first-hand updates and follow Community Guidelines.</Text>
             </TouchableOpacity>
           ) : null}
           <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm and share report" disabled={busy || !interpretation.proposedType || !guidelinesAccepted || !activeDrive} onPress={confirm} style={[styles.confirm, { backgroundColor: c.primary }, (!interpretation.proposedType || !guidelinesAccepted || !activeDrive) && styles.disabled]}>
            <Ionicons name="checkmark-circle" size={24} color={c.primaryForeground} />
            <Text style={[styles.confirmText, { color: c.primaryForeground }]}>Confirm alert</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="road-channels-voice-action"
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityHint={isRecording ? "Release to stop recording and send privately" : "Press and hold to record for up to 15 seconds"}
           disabled={busy || Platform.OS === "web" || !canReport || !!recordedUri}
          onPressIn={isRecording ? undefined : () => {
            pressHeldRef.current = true;
            void startRecording();
          }}
          onPressOut={() => {
            pressHeldRef.current = false;
            if (recordingActiveRef.current) void stopRecording();
          }}
           style={[styles.primaryAction, { backgroundColor: isRecording ? c.destructive : c.primary }, (busy || Platform.OS === "web" || !canReport || !!recordedUri) && styles.disabled]}
        >
          <Ionicons name={isRecording ? "stop-circle" : "mic"} size={34} color={c.primaryForeground} />
          <Text style={[styles.primaryText, { color: c.primaryForeground }]}>{busy ? "Please wait…" : actionLabel}</Text>
        </TouchableOpacity>
      )}

      {!interpretation && !busy && (
        <Text style={[styles.recordingHint, { color: c.mutedForeground }]}>
          {sendCountdown != null
            ? `Sending in ${sendCountdown} second${sendCountdown === 1 ? "" : "s"} · max recording ${MAX_SECONDS} seconds`
            : `Hold to record · release to send · max ${MAX_SECONDS} seconds`}
        </Text>
      )}
      {sendCountdown != null && !busy && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel voice report send" onPress={cancelPendingSend} style={styles.cancelSend}>
          <Text style={[styles.cancelSendLabel, { color: c.destructive }]}>Cancel send</Text>
        </TouchableOpacity>
      )}
      {message && <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.mutedForeground }]}>{message}</Text>}
      {interpretation && !busy && (
        <View style={styles.options}>
          <TouchableOpacity accessibilityRole="button" onPress={rerecord} style={styles.textAction}>
            <Text style={[styles.textActionLabel, { color: c.primary }]}>Re-record</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={cancel} style={styles.textAction}>
            <Text style={[styles.textActionLabel, { color: c.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
      {Platform.OS === "web" && <Text style={[styles.webNote, { color: c.mutedForeground }]}>Voice reporting needs the native mobile app.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 10 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 23 },
  helper: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 21 },
  listenCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 7 },
  listenHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  listenTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  listenCopy: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  listenerControl: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  feedItem: { fontFamily: "Inter_500Medium", fontSize: 12, textTransform: "capitalize" },
  feedRow: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 34 },
  autoSwitchRow: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 34 },
  categorySection: { gap: 5, marginTop: 2 },
  nearbySection: { gap: 5, marginTop: 2 },
  categoryHeading: { fontFamily: "Inter_700Bold", fontSize: 15 },
  categoryHint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 3 },
  categoryChip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7 },
  categoryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  timer: { fontFamily: "Inter_700Bold", fontSize: 32, textAlign: "center", marginVertical: 8 },
  primaryAction: { minHeight: 112, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 7, marginTop: 6 },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 19 },
  recordingHint: { fontFamily: "Inter_500Medium", fontSize: 13, textAlign: "center", lineHeight: 18 },
  cancelSend: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  cancelSendLabel: { fontFamily: "Inter_700Bold", fontSize: 15 },
  disabled: { opacity: 0.55 },
  message: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20, textAlign: "center" },
  result: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 7 },
  resultTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  resultText: { fontFamily: "Inter_600SemiBold", fontSize: 15, textTransform: "capitalize" },
  transcript: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 21 },
  summary: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21 },
  detail: { fontFamily: "Inter_500Medium", fontSize: 13 },
  guidelines: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 4, paddingVertical: 5 },
  guidelinesText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  confirm: { minHeight: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 5 },
  confirmText: { fontFamily: "Inter_700Bold", fontSize: 17 },
  options: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8 },
  textAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  textActionLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  webNote: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
});