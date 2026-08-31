import { File } from "expo-file-system";
import { fetch } from "expo/fetch";

import { API_BASE, ApiError, apiGet, apiPost } from "@/utils/apiClient";

export interface RoadChannelLocation {
  latitude: number;
  longitude: number;
}

export interface RoadChannel {
  id: string;
  name: string;
  road?: string | null;
  memberCount?: number;
}

export interface RoadChannelsDiscovery {
  channels: RoadChannel[];
}

export interface RoadChannelFeedItem {
  id: string;
  type: string;
  road?: string | null;
  createdAt: string;
}

export interface VoiceUploadRequest {
  voiceReportId: string;
  /** A pre-signed absolute URL, or an API-relative upload path. */
  uploadUrl: string;
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
}

export interface VoiceInterpretation {
  voiceReportId: string;
  proposedType: string | null;
  summary?: string | null;
  transcript: string;
  road: string | null;
  speedLimit?: number | null;
  cameraType?: string | null;
}

export interface VoiceReportContext {
  deviceId?: string;
  location?: RoadChannelLocation;
  channelId?: string;
}

export function discoverRoadChannels(roadName: string): Promise<RoadChannelsDiscovery> {
  return apiGet(`/road-channels/discovery?roadName=${encodeURIComponent(roadName)}`);
}

export function updateRoadChannelPresence(context: VoiceReportContext): Promise<void> {
  return apiPost<void>("/road-channels/presence", context);
}

export function getRoadChannelFeed(channelId: string): Promise<{ items: RoadChannelFeedItem[] }> {
  return apiGet(`/road-channels/${encodeURIComponent(channelId)}/feed`);
}

export function requestVoiceUpload(
  context: VoiceReportContext,
  metadata: { contentType: string; sizeBytes: number },
): Promise<VoiceUploadRequest> {
  if (!context.channelId) throw new Error("No supported road channel is active.");
  return apiPost<VoiceUploadRequest>(
    `/road-channels/${encodeURIComponent(context.channelId)}/voice/upload-url`,
    {
      deviceId: context.deviceId,
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      lat: context.location?.latitude,
      lng: context.location?.longitude,
    },
  );
}

/**
 * Sends the local recording only after the backend has issued an upload URL.
 * This is deliberately separate from interpretation and confirmation: an upload
 * is private staging data and never creates a published road report.
 */
export async function uploadVoiceRecording(request: VoiceUploadRequest, uri: string): Promise<void> {
  const uploadUrl = request.uploadUrl.startsWith("http")
    ? request.uploadUrl
    : `${API_BASE}${request.uploadUrl}`;
  if (!uploadUrl) throw new Error("Voice upload is not configured.");

  const file = new File(uri);
  const method = request.method ?? "PUT";
  // expo-file-system's File is a native Blob at runtime. Its SDK 54 type is
  // narrower than the DOM BodyInit declaration used by expo/fetch.
  const uploadFile = file as unknown as Blob;
  const body: BodyInit = method === "POST" ? (() => {
    const form = new FormData();
    form.append("file", uploadFile, file.name);
    return form;
  })() : uploadFile;
  const response = await fetch(uploadUrl, {
    method,
    headers: {
      "Content-Type": "audio/m4a",
      ...request.headers,
    },
    body,
  });
  if (!response.ok) {
    throw new ApiError(response.status, "Could not upload the voice report.");
  }
}

export function interpretVoiceReport(
  voiceReportId: string,
  context: VoiceReportContext,
): Promise<VoiceInterpretation> {
  return apiPost<VoiceInterpretation>(
    `/road-channels/voice/${encodeURIComponent(voiceReportId)}/interpret`,
    { deviceId: context.deviceId },
    45_000,
  );
}

/** Calling this endpoint is the sole publishing action in the voice workflow. */
export function confirmVoiceReport(
  interpretation: VoiceInterpretation,
  context: VoiceReportContext,
): Promise<{ reportId: string; status: string }> {
  if (!interpretation.proposedType) throw new Error("The report type was not clear enough to publish.");
  return apiPost<{ reportId: string; status: string }>(
    `/road-channels/voice/${encodeURIComponent(interpretation.voiceReportId)}/confirm`,
    { deviceId: context.deviceId, type: interpretation.proposedType },
  );
}