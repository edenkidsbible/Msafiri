/**
 * admin-listings.tsx — Admin management screen for community reports and
 * speed cameras / zones.
 *
 * Accessible from Profile → Manage Listings when the admin PIN has been entered.
 * Sections:
 *   Reports  — pending_review / active community reports; approve, deny, edit, relocate
 *   Cameras  — speed cameras, police zones, and other zones in the DB; edit, relocate
 *
 * Uses the /admin-mobile/* endpoints with the stored 30-day JWT.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import AdminZoneEditSheet, { type ZoneEditFields } from "@/components/AdminZoneEditSheet";
import AdminReportEditSheet, { type ReportEditFields } from "@/components/AdminReportEditSheet";
import type { CommunityReport } from "@/context/AppContext";
import type { SpeedZone } from "@/data/speedZones";

// Platform-conditional imports so web doesn't try to load the native modal
const AdminLocationPickerModal =
  Platform.OS !== "web"
    ? require("@/components/AdminLocationPickerModal.native").AdminLocationPickerModal
    : () => null;

// ─── helpers ─────────────────────────────────────────────────────────────────

const BASE_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? "msafirikenya.com"}/api`;
const EAT = "Africa/Nairobi";

function fmtAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2)    return "just now";
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-KE", {
    hour: "numeric", minute: "2-digit", timeZone: EAT,
  });
}

async function adminFetch<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await AsyncStorage.getItem("admin_mobile_token");
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── types ───────────────────────────────────────────────────────────────────

type AdminReport = {
  id: string;
  type: string;
  status: string;
  lat: number;
  lng: number;
  roadName: string | null;
  confirmCount: number;
  denyCount: number;
  adminVerified: boolean;
  speedLimit: number | null;
  cameraType: string | null;
  createdAt: string;
  expiresAt: string | null;
};

type AdminZone = {
  id: string;
  name: string;
  road: string | null;
  speedLimit: number | null;
  type: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  verified: boolean;
  staticId: string | null;
  createdAt: string;
  updatedAt: string;
};

type Section    = "reports" | "cameras";
type ReportTab  = "pending" | "active";
type ZoneFilter = "all" | "camera" | "police" | "zone";

// Picker target shared by both reports and zones
type LocationTarget = {
  id: string;
  lat: number;
  lng: number;
  road: string | null;
  forZone: boolean;
  name?: string; // zone name for the modal title
};

// ─── Zone type display config ─────────────────────────────────────────────────

const ZONE_META: Record<string, { emoji: string; label: string; color: string }> = {
  camera: { emoji: "📷", label: "Camera",    color: "#E53935" },
  police: { emoji: "👮", label: "Police",    color: "#1565C0" },
  zone:   { emoji: "⚠️", label: "Zone",      color: "#E65100" },
};
function zoneInfo(type: string) {
  return ZONE_META[type] ?? { emoji: "📍", label: type, color: "#555" };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminListingsScreen() {
  const c = useColors();
  const { isAdmin } = useApp();

  // Section
  const [section,    setSection]   = useState<Section>("reports");

  // Reports
  const [reportTab,  setReportTab] = useState<ReportTab>("pending");
  const [reports,    setReports]   = useState<AdminReport[]>([]);
  const [rLoading,   setRLoading]  = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Zones
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>("all");
  const [zones,      setZones]      = useState<AdminZone[]>([]);
  const [zLoading,   setZLoading]   = useState(false);

  // Pending camera community reports — shown inside the Cameras section so
  // admins find them where they'd naturally look, not buried in the Reports tab.
  const [pendingCams,    setPendingCams]    = useState<AdminReport[]>([]);
  const [pcLoading,      setPcLoading]      = useState(false);
  const [pcActioningId,  setPcActioningId]  = useState<string | null>(null);

  // Edit sheets
  const [editReport,  setEditReport]  = useState<AdminReport | null>(null);
  const [editZone,    setEditZone]    = useState<AdminZone | null>(null);

  // Location picker
  const [locTarget, setLocTarget] = useState<LocationTarget | null>(null);

  // ── Guard ────────────────────────────────────────────────────────────────
  useEffect(() => { if (!isAdmin) router.back(); }, [isAdmin]);

  // ── Fetch reports ─────────────────────────────────────────────────────────
  const fetchReports = useCallback(async () => {
    setRLoading(true);
    try {
      const status = reportTab === "pending" ? "pending_review" : "active";
      const data = await adminFetch<{ reports: AdminReport[] }>(
        "GET", `/admin-mobile/reports?status=${status}`
      );
      setReports(data.reports ?? []);
    } catch {
      // Keep existing list on error
    } finally {
      setRLoading(false);
    }
  }, [reportTab]);

  useEffect(() => {
    if (section === "reports") fetchReports();
  }, [section, fetchReports]);

  // ── Fetch zones ───────────────────────────────────────────────────────────
  const fetchZones = useCallback(async () => {
    setZLoading(true);
    try {
      const typeParam = zoneFilter === "all" ? "" : `&type=${zoneFilter}`;
      const data = await adminFetch<{ zones: AdminZone[] }>(
        "GET", `/admin-mobile/zones?status=active${typeParam}&limit=100`
      );
      setZones(data.zones ?? []);
    } catch {
      // Keep existing list
    } finally {
      setZLoading(false);
    }
  }, [zoneFilter]);

  // ── Fetch pending community camera reports ────────────────────────────────
  // These are reports submitted by drivers that need admin verification
  // before they appear on the map.  Shown inside the Cameras section so
  // admins find them without having to switch to the Reports tab.
  const fetchPendingCams = useCallback(async () => {
    setPcLoading(true);
    try {
      const data = await adminFetch<{ reports: AdminReport[] }>(
        "GET", "/admin-mobile/reports?status=pending_review&type=camera"
      );
      setPendingCams(data.reports ?? []);
    } catch {
      // Keep existing list
    } finally {
      setPcLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "cameras") {
      fetchZones();
      fetchPendingCams();
    }
  }, [section, fetchZones, fetchPendingCams]);

  // ── Report actions (Reports section) ─────────────────────────────────────
  const approve = useCallback(async (id: string) => {
    setActioningId(id);
    try {
      await adminFetch("POST", `/admin-mobile/reports/${id}/verify`);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      Alert.alert("Error", "Failed to approve report. Please try again.");
    } finally {
      setActioningId(null);
    }
  }, []);

  const deny = useCallback((id: string) => {
    Alert.alert(
      "Deny Report",
      "This will remove the report from the map permanently.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deny", style: "destructive",
          onPress: async () => {
            setActioningId(id);
            try {
              await adminFetch("POST", `/admin-mobile/reports/${id}/deny`);
              setReports((prev) => prev.filter((r) => r.id !== id));
            } catch {
              Alert.alert("Error", "Failed to deny report.");
            } finally {
              setActioningId(null);
            }
          },
        },
      ]
    );
  }, []);

  // ── Pending camera actions (Cameras section) ──────────────────────────────
  const approveCam = useCallback(async (id: string) => {
    setPcActioningId(id);
    try {
      await adminFetch("POST", `/admin-mobile/reports/${id}/verify`);
      setPendingCams((prev) => prev.filter((r) => r.id !== id));
    } catch {
      Alert.alert("Error", "Failed to verify camera report. Please try again.");
    } finally {
      setPcActioningId(null);
    }
  }, []);

  const denyCam = useCallback((id: string) => {
    Alert.alert(
      "Deny Camera Report",
      "This camera report will be removed. Deny only if the location is incorrect or the camera doesn't exist.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deny", style: "destructive",
          onPress: async () => {
            setPcActioningId(id);
            try {
              await adminFetch("POST", `/admin-mobile/reports/${id}/deny`);
              setPendingCams((prev) => prev.filter((r) => r.id !== id));
            } catch {
              Alert.alert("Error", "Failed to deny camera report.");
            } finally {
              setPcActioningId(null);
            }
          },
        },
      ]
    );
  }, []);

  // ── Save report metadata ──────────────────────────────────────────────────
  const saveReportMeta = useCallback(async (id: string, fields: ReportEditFields) => {
    await adminFetch("PATCH", `/admin-mobile/reports/${id}/meta`, fields);
    setReports((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, ...fields, speedLimit: fields.speedLimit ?? null, roadName: fields.roadName ?? null }
          : r
      )
    );
  }, []);

  // ── Save zone metadata ────────────────────────────────────────────────────
  const saveZoneMeta = useCallback(async (id: string, fields: ZoneEditFields) => {
    await adminFetch("PATCH", `/admin-mobile/zones/${id}/meta`, fields);
    setZones((prev) =>
      prev.map((z) =>
        z.id === id
          ? { ...z, ...fields, speedLimit: fields.speedLimit ?? null }
          : z
      )
    );
  }, []);

  // ── Save location (report or zone) ────────────────────────────────────────
  const saveLocation = useCallback(async (
    lat: number, lng: number, roadName?: string
  ) => {
    if (!locTarget) return;
    const { id, forZone } = locTarget;
    if (forZone) {
      await adminFetch("PATCH", `/admin-mobile/zones/${id}/location`, { lat, lng });
      setZones((prev) =>
        prev.map((z) => z.id === id ? { ...z, lat, lng } : z)
      );
    } else {
      await adminFetch("PATCH", `/admin-mobile/reports/${id}/location`, {
        lat, lng, roadName: roadName ?? null,
      });
      setReports((prev) =>
        prev.map((r) => r.id === id ? { ...r, lat, lng, roadName: roadName ?? r.roadName } : r)
      );
    }
  }, [locTarget]);

  if (!isAdmin) return null;

  // ── Report card ───────────────────────────────────────────────────────────
  function renderReport({ item: r }: { item: AdminReport }) {
    const def  = resolveIncidentType(r.type);
    const busy = actioningId === r.id;
    const isPending = r.status === "pending_review";

    return (
      <View style={[ss.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
        {/* Type + status row */}
        <View style={ss.cardTop}>
          <View style={[ss.typePill, { backgroundColor: def.color + "22" }]}>
            <Text style={[ss.typeEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{def.emoji}</Text>
            <Text style={[ss.typeLabel, { color: def.color }]}>{def.label}</Text>
          </View>
          <View style={[
            ss.statusPill,
            { backgroundColor: isPending ? "#F59E0B22" : "#22C55E22" },
          ]}>
            <Text style={[ss.statusTxt, { color: isPending ? "#D97706" : "#16A34A" }]}>
              {isPending ? "Pending" : r.adminVerified ? "Verified ✓" : "Active"}
            </Text>
          </View>
        </View>

        {/* Location */}
        {r.roadName
          ? <Text style={[ss.road, { color: c.foreground }]} numberOfLines={1}>📍 {r.roadName}</Text>
          : <Text style={[ss.road, { color: c.mutedForeground }]} numberOfLines={1}>{r.lat.toFixed(5)}, {r.lng.toFixed(5)}</Text>
        }

        {/* Meta */}
        <Text style={[ss.meta, { color: c.mutedForeground }]}>
          {fmtAge(r.createdAt)} · {fmtTime(r.createdAt)}
          {r.speedLimit != null ? ` · ${r.speedLimit} km/h` : ""}
        </Text>
        <Text style={[ss.meta, { color: c.mutedForeground }]}>
          👍 {r.confirmCount} · 👎 {r.denyCount}
        </Text>

        {/* Action buttons — row 1: approve/deny (pending only), always shown for active */}
        {isPending && (
          <View style={[ss.actionRow, { marginTop: 8 }]}>
            <TouchableOpacity
              style={[ss.btnGreen, busy && ss.btnDisabled]}
              onPress={() => approve(r.id)}
              disabled={busy}
              activeOpacity={0.8}
            >
              {busy
                ? <ActivityIndicator size="small" color="#FFF" />
                : <><Ionicons name="checkmark-circle" size={15} color="#FFF" /><Text style={ss.btnTxtWhite}>Approve</Text></>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.btnOutline, { borderColor: c.destructive + "55" }, busy && ss.btnDisabled]}
              onPress={() => deny(r.id)}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Ionicons name="close-circle" size={15} color={c.destructive} />
              <Text style={[ss.btnTxtColor, { color: c.destructive }]}>Deny</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Row 2: Edit + Location */}
        <View style={ss.actionRow}>
          <TouchableOpacity
            style={[ss.btnOutline, { borderColor: c.border }, busy && ss.btnDisabled]}
            onPress={() => setEditReport(r)}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil" size={14} color={c.foreground} />
            <Text style={[ss.btnTxtColor, { color: c.foreground }]}>Edit Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[ss.btnOutline, { borderColor: c.border }, busy && ss.btnDisabled]}
            onPress={() => setLocTarget({ id: r.id, lat: r.lat, lng: r.lng, road: r.roadName, forZone: false })}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Ionicons name="location" size={14} color="#1565C0" />
            <Text style={[ss.btnTxtColor, { color: "#1565C0" }]}>Fix Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Zone card ─────────────────────────────────────────────────────────────
  function renderZone({ item: z }: { item: AdminZone }) {
    const meta = zoneInfo(z.type);
    return (
      <View style={[ss.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}>
        {/* Type + verified row */}
        <View style={ss.cardTop}>
          <View style={[ss.typePill, { backgroundColor: meta.color + "22" }]}>
            <Text style={[ss.typeEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>{meta.emoji}</Text>
            <Text style={[ss.typeLabel, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {z.verified && (
            <View style={[ss.statusPill, { backgroundColor: "#22C55E22" }]}>
              <Text style={[ss.statusTxt, { color: "#16A34A" }]}>Verified ✓</Text>
            </View>
          )}
          {z.speedLimit != null && (
            <View style={[ss.statusPill, { backgroundColor: "#1565C022" }]}>
              <Text style={[ss.statusTxt, { color: "#1565C0" }]}>{z.speedLimit} km/h</Text>
            </View>
          )}
        </View>

        {/* Name */}
        <Text style={[ss.road, { color: c.foreground }]} numberOfLines={1}>{z.name}</Text>

        {/* Road */}
        {z.road
          ? <Text style={[ss.meta, { color: c.mutedForeground }]} numberOfLines={1}>📍 {z.road}</Text>
          : (z.lat != null && z.lng != null)
            ? <Text style={[ss.meta, { color: c.mutedForeground }]}>{z.lat.toFixed(5)}, {z.lng.toFixed(5)}</Text>
            : <Text style={[ss.meta, { color: c.mutedForeground }]}>No location set</Text>
        }

        {/* Description */}
        {!!z.description && (
          <Text style={[ss.meta, { color: c.mutedForeground }]} numberOfLines={2}>{z.description}</Text>
        )}

        <Text style={[ss.meta, { color: c.mutedForeground }]}>
          {fmtAge(z.updatedAt)} updated
        </Text>

        {/* Actions */}
        <View style={[ss.actionRow, { marginTop: 8 }]}>
          <TouchableOpacity
            style={[ss.btnOutline, { borderColor: c.border }]}
            onPress={() => setEditZone(z)}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil" size={14} color={c.foreground} />
            <Text style={[ss.btnTxtColor, { color: c.foreground }]}>Edit Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[ss.btnOutline, { borderColor: c.border }]}
            onPress={() => setLocTarget({
              id: z.id,
              lat: z.lat ?? 0,
              lng: z.lng ?? 0,
              road: z.road,
              forZone: true,
              name: z.name,
            })}
            activeOpacity={0.8}
          >
            <Ionicons name="location" size={14} color="#1565C0" />
            <Text style={[ss.btnTxtColor, { color: "#1565C0" }]}>Fix Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[ss.root, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[ss.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={ss.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[ss.headerTitle, { color: c.foreground }]}>Manage Listings</Text>
        <TouchableOpacity
          onPress={() => {
            if (section === "reports") fetchReports();
            else { fetchZones(); fetchPendingCams(); }
          }}
          style={ss.refreshBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="refresh" size={22} color={c.primary} />
        </TouchableOpacity>
      </View>

      {/* Section switcher: Reports | Cameras */}
      <View style={[ss.sectionRow, { borderBottomColor: c.border }]}>
        {(["reports", "cameras"] as Section[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[ss.sectionTab, section === s && { borderBottomColor: c.primary }]}
            onPress={() => setSection(s)}
          >
            <Ionicons
              name={s === "reports" ? "flag" : "camera"}
              size={15}
              color={section === s ? c.primary : c.mutedForeground}
            />
            <Text style={[ss.sectionTxt, { color: section === s ? c.primary : c.mutedForeground }]}>
              {s === "reports" ? "Reports" : "Cameras & Zones"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── REPORTS section ─────────────────────────────────────────────── */}
      {section === "reports" && (
        <>
          <View style={[ss.segmentWrap, { backgroundColor: c.muted }]}>
            {(["pending", "active"] as ReportTab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[ss.segmentBtn, reportTab === t && { backgroundColor: c.card }]}
                onPress={() => setReportTab(t)}
              >
                <Text style={[ss.segmentTxt, { color: reportTab === t ? c.primary : c.mutedForeground }]}>
                  {t === "pending" ? "Needs Review" : "Active Reports"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {rLoading ? (
            <View style={ss.center}>
              <ActivityIndicator size="large" color={c.primary} />
              <Text style={[ss.loadingTxt, { color: c.mutedForeground }]}>Loading reports…</Text>
            </View>
          ) : reports.length === 0 ? (
            <View style={ss.center}>
              <Text style={ss.emptyIcon}>{reportTab === "pending" ? "✅" : "🗺️"}</Text>
              <Text style={[ss.emptyTitle, { color: c.foreground }]}>
                {reportTab === "pending" ? "All clear" : "No active reports"}
              </Text>
              <Text style={[ss.emptyText, { color: c.mutedForeground }]}>
                {reportTab === "pending"
                  ? "No reports are waiting for review right now."
                  : "There are no live community reports at the moment."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={reports}
              keyExtractor={(r) => r.id}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <Text style={[ss.countLabel, { color: c.mutedForeground }]}>
                  {reports.length} report{reports.length !== 1 ? "s" : ""}
                </Text>
              }
              renderItem={renderReport}
            />
          )}
        </>
      )}

      {/* ── CAMERAS section ─────────────────────────────────────────────── */}
      {section === "cameras" && (
        <>
          {/* ── Pending community camera reports ── */}
          {/* Shown at the top so admins can verify/deny newly reported cameras
              before they go live. Camera reports start in pending_review status
              and only appear on the map after admin approval. */}
          {(pcLoading || pendingCams.length > 0) && (
            <View style={[ss.pendingCamSection, { borderBottomColor: c.border }]}>
              <View style={ss.pendingCamHeader}>
                <View style={[ss.pendingCamBadge, { backgroundColor: "#F59E0B22" }]}>
                  <Ionicons name="alert-circle" size={14} color="#D97706" />
                  <Text style={[ss.pendingCamBadgeTxt, { color: "#D97706" }]}>
                    Needs Verification
                  </Text>
                </View>
                <Text style={[ss.pendingCamCount, { color: c.mutedForeground }]}>
                  {pcLoading ? "Loading…" : `${pendingCams.length} pending`}
                </Text>
              </View>

              {pcLoading ? (
                <ActivityIndicator size="small" color={c.primary} style={{ marginBottom: 12 }} />
              ) : (
                pendingCams.map((r) => {
                  const busy = pcActioningId === r.id;
                  return (
                    <View
                      key={r.id}
                      style={[ss.pendingCamCard, { backgroundColor: c.card, borderColor: "#F59E0B44" }]}
                    >
                      <View style={ss.cardTop}>
                        <View style={[ss.typePill, { backgroundColor: "#E5393522" }]}>
                          <Text style={[ss.typeEmoji, { fontFamily: EMOJI_FONT_FAMILY }]}>📷</Text>
                          <Text style={[ss.typeLabel, { color: "#E53935" }]}>
                            {r.cameraType === "mobile" ? "Mobile Camera" : "Fixed Camera"}
                          </Text>
                        </View>
                        {r.speedLimit != null && (
                          <View style={[ss.statusPill, { backgroundColor: "#1565C022" }]}>
                            <Text style={[ss.statusTxt, { color: "#1565C0" }]}>{r.speedLimit} km/h</Text>
                          </View>
                        )}
                      </View>

                      {r.roadName
                        ? <Text style={[ss.road, { color: c.foreground }]} numberOfLines={1}>📍 {r.roadName}</Text>
                        : <Text style={[ss.road, { color: c.mutedForeground }]}>{r.lat.toFixed(5)}, {r.lng.toFixed(5)}</Text>
                      }
                      <Text style={[ss.meta, { color: c.mutedForeground }]}>
                        Reported {fmtAge(r.createdAt)} · {fmtTime(r.createdAt)}
                      </Text>

                      <View style={[ss.actionRow, { marginTop: 8 }]}>
                        <TouchableOpacity
                          style={[ss.btnGreen, busy && ss.btnDisabled]}
                          onPress={() => approveCam(r.id)}
                          disabled={busy}
                          activeOpacity={0.8}
                        >
                          {busy
                            ? <ActivityIndicator size="small" color="#FFF" />
                            : <><Ionicons name="checkmark-circle" size={15} color="#FFF" /><Text style={ss.btnTxtWhite}>Verify</Text></>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[ss.btnOutline, { borderColor: c.destructive + "55" }, busy && ss.btnDisabled]}
                          onPress={() => denyCam(r.id)}
                          disabled={busy}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="close-circle" size={15} color={c.destructive} />
                          <Text style={[ss.btnTxtColor, { color: c.destructive }]}>Deny</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[ss.btnOutline, { borderColor: c.border }, busy && ss.btnDisabled]}
                          onPress={() => setLocTarget({ id: r.id, lat: r.lat, lng: r.lng, road: r.roadName, forZone: false })}
                          disabled={busy}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="location" size={14} color="#1565C0" />
                          <Text style={[ss.btnTxtColor, { color: "#1565C0" }]}>Map</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* Zone type filter tabs */}
          <View style={[ss.filterRow, { backgroundColor: c.muted }]}>
            {(["all", "camera", "police", "zone"] as ZoneFilter[]).map((f) => {
              const active = zoneFilter === f;
              const meta   = f === "all" ? null : zoneInfo(f);
              return (
                <TouchableOpacity
                  key={f}
                  style={[ss.filterBtn, active && { backgroundColor: c.card }]}
                  onPress={() => setZoneFilter(f)}
                >
                  {meta && (
                    <Text style={{ fontSize: 12, fontFamily: EMOJI_FONT_FAMILY }}>
                      {meta.emoji}
                    </Text>
                  )}
                  <Text style={[ss.filterTxt, { color: active ? c.primary : c.mutedForeground }]}>
                    {f === "all" ? "All" : meta!.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {zLoading ? (
            <View style={ss.center}>
              <ActivityIndicator size="large" color={c.primary} />
              <Text style={[ss.loadingTxt, { color: c.mutedForeground }]}>Loading zones…</Text>
            </View>
          ) : zones.length === 0 ? (
            <View style={ss.center}>
              <Text style={ss.emptyIcon}>📷</Text>
              <Text style={[ss.emptyTitle, { color: c.foreground }]}>No zones found</Text>
              <Text style={[ss.emptyText, { color: c.mutedForeground }]}>
                No{zoneFilter !== "all" ? ` ${zoneFilter}` : ""} zones are in the database yet.{"\n"}
                Zones promoted from the map or created by admins appear here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={zones}
              keyExtractor={(z) => z.id}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <Text style={[ss.countLabel, { color: c.mutedForeground }]}>
                  {zones.length} zone{zones.length !== 1 ? "s" : ""}
                </Text>
              }
              renderItem={renderZone}
            />
          )}
        </>
      )}

      {/* ── Report edit sheet ─────────────────────────────────────────────── */}
      {editReport && (
        <AdminReportEditSheet
          report={editReport as unknown as CommunityReport}
          visible={!!editReport}
          onClose={() => setEditReport(null)}
          onSave={(fields) => saveReportMeta(editReport.id, fields)}
        />
      )}

      {/* ── Zone edit sheet ───────────────────────────────────────────────── */}
      {editZone && (
        <AdminZoneEditSheet
          zone={editZone as unknown as SpeedZone}
          visible={!!editZone}
          onClose={() => setEditZone(null)}
          onSave={(fields) => saveZoneMeta(editZone.id, fields)}
        />
      )}

      {/* ── Location picker (reports + zones) ────────────────────────────── */}
      {locTarget && Platform.OS !== "web" && (
        <AdminLocationPickerModal
          visible={!!locTarget}
          reportId={locTarget.id}
          initialLat={locTarget.lat}
          initialLng={locTarget.lng}
          initialRoadName={locTarget.road ?? undefined}
          title={locTarget.forZone ? `Fix Location — ${locTarget.name ?? "Zone"}` : "Fix Report Location"}
          successMessage={locTarget.forZone ? "Zone location has been saved." : "The report position has been saved."}
          onClose={() => setLocTarget(null)}
          onSave={saveLocation}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn:     { width: 44, alignItems: "flex-start", paddingLeft: 8 },
  refreshBtn:  { width: 44, alignItems: "flex-end",   paddingRight: 8 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },

  // Section switcher (Reports | Cameras)
  sectionRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // Pending community camera reports (inside Cameras section)
  pendingCamSection: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  pendingCamHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  pendingCamBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  pendingCamBadgeTxt: { fontSize: 12, fontWeight: "600" },
  pendingCamCount:    { fontSize: 12 },
  pendingCamCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 4,
  },
  sectionTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  sectionTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Sub-tabs (inside Reports: Pending | Active)
  segmentWrap: {
    flexDirection: "row",
    margin: 16,
    borderRadius: 12,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  segmentTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Zone type filter (inside Cameras)
  filterRow: {
    flexDirection: "row",
    margin: 16,
    borderRadius: 12,
    padding: 3,
  },
  filterBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
  },
  filterTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  loadingTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyText:  { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  countLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 5,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" },

  typePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeEmoji: { fontSize: 13 },
  typeLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusTxt:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  road: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },

  actionRow: { flexDirection: "row", gap: 8, marginTop: 4 },

  btnGreen: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#22C55E",
    borderRadius: 10,
    paddingVertical: 9,
  },
  btnOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 9,
  },
  btnTxtWhite: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  btnTxtColor: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  btnDisabled: { opacity: 0.5 },
});
