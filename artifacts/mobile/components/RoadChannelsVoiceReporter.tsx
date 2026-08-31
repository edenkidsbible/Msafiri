import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { getInfoAsync } from "expo-file-system/legacy";
import { requestAndroidMicrophonePermission } from "@/utils/androidCameraPermissions";

import { useColors } from "@/hooks/useColors";
import {
  confirmVoiceReport,
  discoverRoadChannels,
  getRoadChannelFeed,
  interpretVoiceReport,
  requestVoiceUpload,
  updateRoadChannelPresence,
  uploadVoiceRecording,
  type RoadChannel,
  type RoadChannelLocation,
  type VoiceInterpretation,
} from "@/utils/roadChannelsApi";

const MAX_SECONDS = 15;
const MIN_USEFUL_SECONDS = 2;
const PLAYBACK_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  interruptionMode: "duckOthers" as const,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};

export interface RoadChannelsVoiceReporterProps {
  /** Pass the driver's current position when available. */
  location?: RoadChannelLocation | null;
  deviceId?: string;
  roadName?: string | null;
  /** Lets a parent surface a successful confirmed report without coupling to AppContext. */
  onConfirmed?: (reportId: string, interpretation: VoiceInterpretation) => void;
  onCancelled?: () => void;
}

function timeLabel(milliseconds: number): string {
  const seconds = Math.min(MAX_SECONDS, Math.floor(milliseconds / 1000));
  return `0:${seconds.toString().padStart(2, "0")}`;
}

/**
 * A standalone, confirmation-gated Road Channels voice reporting control.
 * It purposefully owns no shared app state, so it can be placed in any screen.
 */
export default function RoadChannelsVoiceReporter({
  location = null,
  deviceId,
  roadName,
  onConfirmed,
  onCancelled,
}: RoadChannelsVoiceReporterProps) {
  const c = useColors();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 200);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<VoiceInterpretation | null>(null);
  const [channel, setChannel] = useState<RoadChannel | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<"loading" | "available" | "unavailable">("loading");

  const clearStopTimer = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };

  // Discovery, presence and feed are intentionally best-effort context calls;
  // a report remains usable if a channel has no current feed.
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (roadName === undefined) {
      setChannel(null);
      setDiscoveryStatus("loading");
      return;
    }
    if (!location || !roadName) {
      setChannel(null);
      setDiscoveryStatus("unavailable");
      return;
    }
    let active = true;
    setChannel(null);
    setDiscoveryStatus("loading");
    discoverRoadChannels(roadName)
      .then(async ({ channels }) => {
        if (!active) return;
        const nearest = channels[0] ?? null;
        setChannel(nearest);
        setDiscoveryStatus(nearest ? "available" : "unavailable");
        if (nearest) {
          // Presence/feed context is best-effort and must never turn a valid
          // road discovery into an unsupported-road state.
          void Promise.allSettled([
            updateRoadChannelPresence({ deviceId, location, channelId: nearest.id }),
            getRoadChannelFeed(nearest.id),
          ]);
        }
      })
      .catch(() => {
        if (!active) return;
        setChannel(null);
        setDiscoveryStatus("unavailable");
      });
    return () => { active = false; };
  }, [deviceId, location?.latitude, location?.longitude, roadName]);

  useEffect(() => () => clearStopTimer(), []);

  const stopRecording = async () => {
    clearStopTimer();
    if (!recorder.isRecording) return;
    try {
      // Read from the recorder, rather than hook state captured by an auto-stop
      // timeout, so the minimum-duration check remains correct at 15 seconds.
      const durationMillis = recorder.getStatus().durationMillis;
      await recorder.stop();
      await setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
      const uri = recorder.uri;
      if (!uri) throw new Error("The recording could not be saved.");
      if (durationMillis < MIN_USEFUL_SECONDS * 1000) {
        setMessage(`Hold for at least ${MIN_USEFUL_SECONDS} seconds so we can understand the report.`);
        return;
      }
      setRecordedUri(uri);
      setMessage("Ready to check your report.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop recording.");
    }
  };

  const startRecording = async () => {
    if (Platform.OS === "web") {
      setMessage("Voice reporting is available in the Msafiri mobile app.");
      return;
    }
    setMessage(null);
    setInterpretation(null);
    setRecordedUri(null);
    try {
      const permission = Platform.OS === "android"
        ? {
            granted: await requestAndroidMicrophonePermission(),
            canAskAgain: true,
          }
        : await (async () => {
            const current = await getRecordingPermissionsAsync();
            return current.granted ? current : requestRecordingPermissionsAsync();
          })();
      if (!permission.granted) {
        const detail = "Enable Microphone for Msafiri in Settings to report by voice.";
        setMessage(detail);
        Alert.alert("Microphone unavailable", detail, [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => {}) },
        ]);
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      stopTimer.current = setTimeout(() => { void stopRecording(); }, MAX_SECONDS * 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start recording.");
    }
  };

  const interpret = async () => {
    if (!recordedUri) return;
    setBusy(true);
    setMessage("Listening to your report…");
    try {
      const context = { deviceId, location: location ?? undefined, channelId: channel?.id };
      const fileInfo = await getInfoAsync(recordedUri);
      if (!fileInfo.exists || !fileInfo.size) throw new Error("The voice recording could not be read.");
      const request = await requestVoiceUpload(context, {
        contentType: "audio/mp4",
        sizeBytes: fileInfo.size,
      });
      await uploadVoiceRecording(request, recordedUri);
      const result = await interpretVoiceReport(request.voiceReportId, context);
      setInterpretation(result);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not interpret that report. Please re-record.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!interpretation) return;
    setBusy(true);
    try {
      const result = await confirmVoiceReport(interpretation, {
        deviceId, location: location ?? undefined, channelId: channel?.id,
      });
      setMessage("Report shared with Road Channels.");
      onConfirmed?.(result.reportId, interpretation);
      setInterpretation(null);
      setRecordedUri(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm the report. Nothing was published.");
    } finally {
      setBusy(false);
    }
  };

  const rerecord = () => {
    setRecordedUri(null);
    setInterpretation(null);
    setMessage(null);
  };

  const cancel = () => {
    clearStopTimer();
    if (recorder.isRecording) {
      void recorder.stop().finally(() => {
        void setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
      });
    }
    rerecord();
    onCancelled?.();
  };

  const isRecording = recording.isRecording;
  const actionLabel = isRecording ? "Tap to stop" : recordedUri ? "Understand report" : "Tap and speak";

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.eyebrow, { color: c.mutedForeground }]}>ROAD CHANNELS</Text>
      <Text style={[styles.title, { color: c.foreground }]}>Report by voice</Text>
      <Text style={[styles.helper, { color: c.mutedForeground }]}>
         {discoveryStatus === "loading"
           ? "Finding your road…"
           : channel?.name
             ? `Sharing with ${channel.name}`
             : "This road has no Road Channel yet. Check back later."}
      </Text>

      {isRecording && <Text style={[styles.timer, { color: c.destructive }]} accessibilityLiveRegion="polite">{timeLabel(recording.durationMillis)} / 0:15</Text>}

      {interpretation ? (
        <View style={[styles.result, { backgroundColor: c.secondary, borderColor: c.border }]}>
          <Text style={[styles.resultTitle, { color: c.foreground }]}>Check before sharing</Text>
           <Text style={[styles.resultText, { color: c.foreground }]}>
             {interpretation.proposedType ?? "Could not identify an alert"} · {interpretation.road ?? "Road not recognised"}
           </Text>
           {interpretation.summary ? <Text style={[styles.summary, { color: c.foreground }]}>{interpretation.summary}</Text> : null}
          <Text style={[styles.transcript, { color: c.mutedForeground }]}>{interpretation.transcript}</Text>
          {interpretation.speedLimit != null && <Text style={[styles.detail, { color: c.mutedForeground }]}>Speed limit: {interpretation.speedLimit} km/h</Text>}
          {interpretation.cameraType && <Text style={[styles.detail, { color: c.mutedForeground }]}>Camera: {interpretation.cameraType}</Text>}
           <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm and share report" disabled={busy || !interpretation.proposedType} onPress={confirm} style={[styles.confirm, { backgroundColor: c.primary }, !interpretation.proposedType && styles.disabled]}>
            <Ionicons name="checkmark-circle" size={24} color={c.primaryForeground} />
            <Text style={[styles.confirmText, { color: c.primaryForeground }]}>Confirm alert</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="road-channels-voice-action"
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityHint={isRecording ? "Stops and saves the voice report" : "Starts a voice report up to 15 seconds"}
          disabled={busy || Platform.OS === "web" || discoveryStatus !== "available"}
          onPress={isRecording ? () => { void stopRecording(); } : recordedUri ? interpret : () => { void startRecording(); }}
          style={[styles.primaryAction, { backgroundColor: isRecording ? c.destructive : c.primary }, (busy || Platform.OS === "web" || discoveryStatus !== "available") && styles.disabled]}
        >
          <Ionicons name={isRecording ? "stop-circle" : "mic"} size={34} color={c.primaryForeground} />
          <Text style={[styles.primaryText, { color: c.primaryForeground }]}>{busy ? "Please wait…" : actionLabel}</Text>
        </TouchableOpacity>
      )}

      {message && <Text accessibilityLiveRegion="polite" style={[styles.message, { color: c.mutedForeground }]}>{message}</Text>}
      {(recordedUri || interpretation) && !busy && (
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
  timer: { fontFamily: "Inter_700Bold", fontSize: 32, textAlign: "center", marginVertical: 8 },
  primaryAction: { minHeight: 112, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 7, marginTop: 6 },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 19 },
  disabled: { opacity: 0.55 },
  message: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20, textAlign: "center" },
  result: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 7 },
  resultTitle: { fontFamily: "Inter_700Bold", fontSize: 17 },
  resultText: { fontFamily: "Inter_600SemiBold", fontSize: 15, textTransform: "capitalize" },
  transcript: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 21 },
  summary: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21 },
  detail: { fontFamily: "Inter_500Medium", fontSize: 13 },
  confirm: { minHeight: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginTop: 5 },
  confirmText: { fontFamily: "Inter_700Bold", fontSize: 17 },
  options: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8 },
  textAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  textActionLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  webNote: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
});