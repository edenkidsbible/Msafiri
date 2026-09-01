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
  direction?: "inbound" | "outbound" | "unknown";
  nearby?: boolean;
  distanceM?: number | null;
}

export interface RoadChannelsDiscovery {
  channels: RoadChannel[];
}

export interface RoadChannelFeedItem {
  id: string;
  type: string;
  road?: string | null;
  summary?: string | null;
  audioUrl?: string | null;
  createdAt: string;
  reportId?: string | null;
}

export interface VoiceUploadRequest {
  voiceReportId: string;
  /** A pre-signed absolute URL, or an API-relative upload path. */
  uploadUrl: string;
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
  contentType?: string;
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
  roadName?: string | null;
}

export function discoverRoadChannels(
  roadNames: string | string[],
  heading?: number | null,
  location?: RoadChannelLocation | null,
  radiusM = 5_000,
): Promise<RoadChannelsDiscovery> {
  const params = new URLSearchParams();
  for (const roadName of (Array.isArray(roadNames) ? roadNames : [roadNames])) {
    if (roadName.trim()) params.append("roadName", roadName);
  }
  if (heading != null) params.set("heading", String(heading));
  if (location) {
    params.set("lat", String(location.latitude));
    params.set("lng", String(location.longitude));
    params.set("radiusM", String(Math.min(5_000, Math.max(100, radiusM))));
  }
  return apiGet(`/road-channels/discovery?${params.toString()}`);
}

export function updateRoadChannelPresence(context: VoiceReportContext): Promise<void> {
  return apiPost<void>("/road-channels/presence", context);
}

export interface RoadChannelFeed {
  items: RoadChannelFeedItem[];
  cursor: string | null;
}

/** Accepts both the current pilot `updates` envelope and the cursor envelope
 * used by newer channel deployments. */
export async function getRoadChannelFeed(
  channelId: string,
  deviceId: string,
  cursor?: string | null,
): Promise<RoadChannelFeed> {
  const params = new URLSearchParams({ deviceId });
  if (cursor) params.set("cursor", cursor);
  const response = await apiGet<{
    items?: RoadChannelFeedItem[];
    updates?: Array<{
      id: string; kind: string; reportId?: string | null; createdAt: string | number;
      summary?: string | null; audioUrl?: string | null; road?: string | null; type?: string;
    }>;
    cursor?: string | null;
    nextCursor?: string | null;
  }>(`/road-channels/${encodeURIComponent(channelId)}/feed?${params.toString()}`);
  const rawItems = response.items ?? response.updates ?? [];
  return {
    items: rawItems.map((item) => ({
      id: item.id,
      type: ("type" in item ? item.type : item.kind) ?? "road_update",
      road: "road" in item ? item.road : null,
      summary: item.summary ?? null,
      audioUrl: item.audioUrl ?? null,
      reportId: item.reportId ?? null,
      createdAt: typeof item.createdAt === "number" ? new Date(item.createdAt).toISOString() : item.createdAt,
    })),
    cursor: response.nextCursor ?? response.cursor ?? (rawItems[0]?.id ?? null),
  };
}

export function leaveRoadChannel(channelId: string, deviceId: string): Promise<void> {
  return apiPost<void>(`/road-channels/${encodeURIComponent(channelId)}/leave`, { deviceId });
}

export function setRoadChannelMuted(channelId: string, deviceId: string, muted: boolean): Promise<void> {
  return apiPost<void>(`/road-channels/${encodeURIComponent(channelId)}/mute`, { deviceId, muted });
}

export function requestVoiceUpload(
  context: VoiceReportContext,
  metadata: { contentType: string; sizeBytes: number },
): Promise<VoiceUploadRequest> {
  const endpoint = context.channelId
    ? `/road-channels/${encodeURIComponent(context.channelId)}/voice/upload-url`
    : "/road-channels/voice/upload-url";
  return apiPost<VoiceUploadRequest>(
    endpoint,
    {
      deviceId: context.deviceId,
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      lat: context.location?.latitude,
      lng: context.location?.longitude,
      roadName: context.roadName,
    },
  );
}

/**
 * Sends the local recording only after the backend has issued an upload URL.
 * This is deliberately separate from interpretation and confirmation: an upload
 * is private staging data and never creates a published road report.
 */
export async function uploadVoiceRecording(
  request: VoiceUploadRequest,
  uri: string,
  contentType = "audio/mp4",
): Promise<void> {
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
      "Content-Type": request.contentType ?? contentType,
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
  options?: { selectedCategory?: RoadChannelCategory; communityGuidelinesAccepted?: boolean },
): Promise<{ reportId: string; status: string }> {
  if (!interpretation.proposedType) throw new Error("The report type was not clear enough to publish.");
  return apiPost<{ reportId: string; status: string }>(
    `/road-channels/voice/${encodeURIComponent(interpretation.voiceReportId)}/confirm`,
    {
      deviceId: context.deviceId,
      type: interpretation.proposedType,
      // The backend remains the source of truth for the interpreted type. These
      // pilot fields preserve the driver's structured intent for compatible API
      // versions without turning any pre-confirm action into publication.
      selectedCategory: options?.selectedCategory,
      communityGuidelinesAccepted: options?.communityGuidelinesAccepted,
    },
  );
}

export const ROAD_CHANNEL_CATEGORIES = [
  "traffic",
  "accident",
  "police_checkpoint",
  "roadworks",
  "hazard",
  "speed_camera",
  "flooding",
  "breakdown",
] as const;

export type RoadChannelCategory = (typeof ROAD_CHANNEL_CATEGORIES)[number];