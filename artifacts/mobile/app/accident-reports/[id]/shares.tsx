/**
 * Accident Report — Share Links Manager
 *
 * Lists all share links (active and revoked) for a single accident record.
 * Allows creating new links with an optional label, copying the URL,
 * native-sharing, and revoking.
 *
 * Route: /accident-reports/:id/shares
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
  Clipboard,
} from "react-native";
import { KeyboardInputModal } from "@/components/KeyboardInputModal";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
// EAT helpers — timezone-safe date formatting for Kenya (UTC+3)
const EAT = "Africa/Nairobi";
const eatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: EAT });
const eatDayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: EAT });
import { useApp } from "@/context/AppContext";
import { apiDelete, apiGet, apiPost } from "@/utils/apiClient";
import { useColors } from "@/hooks/useColors";

const SHARE_BASE = "https://msafirikenya.com/accident-report";

interface ShareRow {
  id: string;           // also the token
  accidentId: string;
  label: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function AccidentSharesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deviceId } = useApp();
  const colors = useColors();

  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!deviceId || !id) return;
    try {
      const data = await apiGet(`/accidents/${id}/shares?deviceId=${deviceId}`) as { shares: ShareRow[] };
      setShares(data.shares);
    } catch {
      Alert.alert("Error", "Could not load share links.");
    } finally {
      setLoading(false);
    }
  }, [deviceId, id]);

  useEffect(() => { load(); }, [load]);

  const createShare = useCallback(async (label: string) => {
    if (!deviceId || !id) return;
    setCreating(true);
    try {
      await apiPost(`/accidents/${id}/shares`, {
        deviceId,
        label: label.trim() || undefined,
      });
      setNewLabel("");
      await load();
    } catch {
      Alert.alert("Error", "Could not create share link.");
    } finally {
      setCreating(false);
    }
  }, [deviceId, id, load]);

  const copyLink = useCallback((token: string) => {
    const url = `${SHARE_BASE}/${token}`;
    Clipboard.setString(url);
    Alert.alert("Copied", "Share link copied to clipboard.");
  }, []);

  const shareLink = useCallback(async (token: string, label: string | null) => {
    const url = `${SHARE_BASE}/${token}`;
    const title = label ? `Crash Report — ${label}` : "Msafiri Kenya — Crash Report";
    try {
      await Share.share({ url, message: title });
    } catch { /* dismissed */ }
  }, []);

  const revokeShare = useCallback((token: string, label: string | null) => {
    const name = label ?? "this share link";
    Alert.alert(
      "Revoke Link",
      `Revoke "${name}"? Anyone with the link will no longer be able to view the report.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            setRevoking(token);
            try {
              await apiDelete(`/accidents/${id}/shares/${token}`, { deviceId });
              await load();
            } catch {
              Alert.alert("Error", "Could not revoke share link.");
            } finally {
              setRevoking(null);
            }
          },
        },
      ],
    );
  }, [id, deviceId, load]);

  const styles = makeStyles(colors);
  const active  = shares.filter((s) => !s.revokedAt);
  const revoked = shares.filter((s) => !!s.revokedAt);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Share Links</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Anyone with a link can view this report
          </Text>
        </View>
      </View>

      {/* Label input modal — slides up above the keyboard */}
      <KeyboardInputModal
        visible={showLabelModal}
        label="Link label (optional)"
        value={newLabel}
        onChangeText={setNewLabel}
        onDone={() => {
          setShowLabelModal(false);
          createShare(newLabel);
        }}
        onCancel={() => setShowLabelModal(false)}
        placeholder="e.g. For insurer, For police"
        autoCapitalize="sentences"
      />

      <FlatList
        data={[]}
        ListHeaderComponent={
          <View style={styles.inner}>
            {/* Create new link */}
            <TouchableOpacity
              style={[styles.createBtn, { backgroundColor: colors.primary, opacity: creating ? 0.7 : 1 }]}
              onPress={() => { setNewLabel(""); setShowLabelModal(true); }}
              activeOpacity={0.85}
              disabled={creating}
            >
              {creating
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="add-circle-outline" size={20} color="#fff" />
              }
              <Text style={styles.createBtnText}>{creating ? "Creating…" : "Create New Share Link"}</Text>
            </TouchableOpacity>

            {/* Loading */}
            {loading && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}

            {/* Active shares */}
            {!loading && active.length > 0 && (
              <>
                <Text style={[styles.sectionHeading, { color: colors.mutedForeground }]}>ACTIVE</Text>
                {active.map((s) => (
                  <ShareCard
                    key={s.id}
                    share={s}
                    isRevoking={revoking === s.id}
                    onCopy={() => copyLink(s.id)}
                    onShare={() => shareLink(s.id, s.label)}
                    onRevoke={() => revokeShare(s.id, s.label)}
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </>
            )}

            {!loading && active.length === 0 && shares.length === 0 && (
              <View style={[styles.empty, { borderColor: colors.border }]}>
                <Ionicons name="link-outline" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  No share links yet.{"\n"}Create one to share this report with insurers or authorities.
                </Text>
              </View>
            )}

            {/* Revoked shares */}
            {!loading && revoked.length > 0 && (
              <>
                <Text style={[styles.sectionHeading, { color: colors.mutedForeground, marginTop: 24 }]}>REVOKED</Text>
                {revoked.map((s) => (
                  <ShareCard
                    key={s.id}
                    share={s}
                    isRevoking={false}
                    revoked
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </>
            )}
          </View>
        }
        renderItem={() => null}
        keyExtractor={() => ""}
      />
    </SafeAreaView>
  );
}

function ShareCard({
  share,
  isRevoking,
  revoked,
  onCopy,
  onShare,
  onRevoke,
  colors,
  styles,
}: {
  share: ShareRow;
  isRevoking: boolean;
  revoked?: boolean;
  onCopy?: () => void;
  onShare?: () => void;
  onRevoke?: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const url = `${SHARE_BASE}/${share.id}`;
  return (
    <View style={[
      styles.card,
      {
        backgroundColor: colors.card,
        borderColor: revoked ? colors.border + "50" : colors.border,
        opacity: revoked ? 0.6 : 1,
      },
    ]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardLabel, { color: colors.text }]} numberOfLines={1}>
            {share.label ?? "Untitled link"}
          </Text>
          <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
            Created {eatDate(share.createdAt)}
            {revoked && share.revokedAt ? ` · Revoked ${eatDayMonth(share.revokedAt)}` : ""}
          </Text>
        </View>
        {!revoked && (
          <View style={[styles.activeBadge, { backgroundColor: "#16A34A18" }]}>
            <Text style={[styles.activeBadgeText, { color: "#16A34A" }]}>Active</Text>
          </View>
        )}
      </View>
      <Text style={[styles.cardUrl, { color: colors.mutedForeground }]} numberOfLines={1}>{url}</Text>

      {!revoked && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={onCopy} activeOpacity={0.7}>
            <Ionicons name="copy-outline" size={15} color={colors.text} />
            <Text style={[styles.actionBtnText, { color: colors.text }]}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={onShare} activeOpacity={0.7}>
            <Ionicons name="share-outline" size={15} color={colors.text} />
            <Text style={[styles.actionBtnText, { color: colors.text }]}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: "#EF444440" }]}
            onPress={onRevoke}
            disabled={isRevoking}
            activeOpacity={0.7}
          >
            {isRevoking
              ? <ActivityIndicator size="small" color="#EF4444" />
              : <>
                  <Ionicons name="trash-outline" size={15} color="#EF4444" />
                  <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Revoke</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.background },
    header:      { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
    backBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginTop: 2 },
    title:       { fontSize: 20, fontFamily: "Inter_700Bold" },
    sub:         { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    inner:       { paddingHorizontal: 16, paddingBottom: 40 },

    createBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 16, marginBottom: 20 },
    createBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

    form:        { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
    formLabel:   { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
    formInput:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12 },
    formBtns:    { flexDirection: "row", gap: 10 },
    cancelBtn:   { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 12, borderWidth: 1 },
    cancelBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
    saveBtn:     { flex: 2, alignItems: "center", paddingVertical: 13, borderRadius: 12 },
    saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

    sectionHeading: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 10 },

    card:        { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
    cardTop:     { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
    cardLabel:   { fontSize: 15, fontFamily: "Inter_600SemiBold" },
    cardDate:    { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
    cardUrl:     { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 12 },
    activeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    activeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

    cardActions: { flexDirection: "row", gap: 8 },
    actionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 12, borderWidth: 1 },
    actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

    center:      { paddingVertical: 40, alignItems: "center" },
    empty:       { alignItems: "center", padding: 36, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", gap: 12, marginTop: 8 },
    emptyText:   { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  });
}
