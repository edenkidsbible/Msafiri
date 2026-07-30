// Per-tab error boundary — isolates a crash in this tab from the other tabs
// and the navigation shell. Expo Router picks this up automatically.
export { ErrorBoundary } from "@/components/ErrorBoundary";

import React, { useEffect, useMemo, useState } from "react";
import { FLAT_LIST_PROPS, SCROLL_PROPS } from "@/lib/scrollProps";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import FinesContent from "@/components/FinesContent";
import { useCourseData } from "@/hooks/useCourseData";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { useCourseSearch } from "@/hooks/useCourseSearch";

const DISCLAIMER_KEY = "learn_disclaimer_accepted";

type ViewMode = "learn" | "fines";

// ── Learn view ────────────────────────────────────────────────────────────────
function LearnBrowseView({ bottomInset, tabBarHeight }: { bottomInset: number; tabBarHeight: number }) {
  const c = useColors();
  const router = useRouter();
  const { deviceId } = useApp();
  const { chapters, loading: chaptersLoading } = useCourseData();
  const { progress } = useCourseProgress(deviceId);

  const completedSlugs = useMemo(
    () => new Set(progress.map((p) => p.lessonSlug)),
    [progress]
  );

  const titleIndex = useMemo(
    () => chapters.flatMap((ch) => ch.lessons.map((l) => ({ slug: l.slug, title: l.title }))),
    [chapters]
  );
  const { query, setQuery, results: searchResults, searching } = useCourseSearch(titleIndex);
  const isSearchActive = query.trim().length > 0;

  const totalLessons = chapters.reduce((s, ch) => s + ch.lessons.length, 0);
  const completedLessons = chapters.reduce(
    (s, ch) => s + ch.lessons.filter((l) => completedSlugs.has(l.slug)).length,
    0
  );
  const overallPct = totalLessons > 0 ? completedLessons / totalLessons : 0;

  if (chaptersLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  const paddingBottom = bottomInset + tabBarHeight + 20;

  return (
    <View style={{ flex: 1 }}>
      {/* ── Search bar ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 }}>
        <View style={[styles.learnSearchBar, { backgroundColor: c.muted, borderColor: c.border }]}>
          <Feather name="search" size={15} color={c.mutedForeground} />
          <TextInput
            style={[styles.learnSearchInput, { color: c.foreground }]}
            placeholder="Search lessons…"
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator size="small" color={c.mutedForeground} />}
          {!searching && query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={14} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Search results ── */}
      {isSearchActive ? (
        <ScrollView
          {...SCROLL_PROPS}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom, gap: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {searching ? (
            <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
              <ActivityIndicator color={c.primary} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>Searching…</Text>
            </View>
          ) : searchResults.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
              <Feather name="search" size={26} color={c.mutedForeground} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>No results for "{query}"</Text>
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
              </Text>
              {searchResults.map((r) => (
                <TouchableOpacity
                  key={r.slug}
                  style={[styles.learnSearchResult, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => router.push(`/course/${r.slug}` as any)}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.learnSearchResultTitle, { color: c.foreground }]} numberOfLines={2}>{r.title}</Text>
                    {r.excerpt ? (
                      <Text style={[styles.learnSearchResultExcerpt, { color: c.mutedForeground }]} numberOfLines={2}>{r.excerpt}</Text>
                    ) : null}
                    {r.estimatedMinutes > 0 ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Feather name="clock" size={10} color={c.mutedForeground} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: c.mutedForeground }}>~{r.estimatedMinutes} min</Text>
                      </View>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={15} color={c.mutedForeground} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        /* ── Chapter list ── */
        <FlatList
          {...FLAT_LIST_PROPS}
          data={chapters}
          keyExtractor={(ch) => ch.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={
            <View style={[styles.learnHeader, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.learnHeaderTitle, { color: c.foreground }]}>Driving Course</Text>
                <Text style={[styles.learnHeaderSub, { color: c.mutedForeground }]}>
                  {completedLessons} of {totalLessons} lessons complete
                </Text>
                <View style={[styles.learnProgBg, { backgroundColor: c.muted, marginTop: 10 }]}>
                  <View style={[styles.learnProgFill, { backgroundColor: c.primary, width: `${Math.round(overallPct * 100)}%` as any }]} />
                </View>
              </View>
              <Text style={[styles.learnOverallPct, { color: c.primary }]}>
                {Math.round(overallPct * 100)}%
              </Text>
            </View>
          }
          renderItem={({ item: ch }) => {
            const chDone = ch.lessons.filter((l) => completedSlugs.has(l.slug)).length;
            const chPct = ch.lessons.length > 0 ? chDone / ch.lessons.length : 0;
            const estMins = ch.lessons.reduce((s, l) => s + (l.estimatedMinutes ?? 0), 0);
            return (
              <TouchableOpacity
                style={[styles.learnChapter, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => {
                  const target =
                    ch.lessons.find((l) => !completedSlugs.has(l.slug)) ??
                    ch.lessons[0];
                  if (target) router.push(`/course/${target.slug}` as any);
                }}
                activeOpacity={0.75}
              >
                <View style={[styles.learnChUnit, { backgroundColor: c.primary + "18" }]}>
                  <Text style={[styles.learnChUnitTxt, { color: c.primary }]}>{ch.unitNumber}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.learnChTitle, { color: c.foreground }]} numberOfLines={2}>
                    {ch.title}
                  </Text>
                  <View style={[styles.learnProgBg, { backgroundColor: c.muted }]}>
                    <View style={[styles.learnProgFill, { backgroundColor: chPct === 1 ? "#00C853" : c.primary, width: `${Math.round(chPct * 100)}%` as any }]} />
                  </View>
                  <Text style={[styles.learnChSub, { color: c.mutedForeground }]}>
                    {chDone}/{ch.lessons.length} lessons
                    {estMins > 0 ? ` · ${estMins} min` : ""}
                    {chPct === 1 ? " · ✓ Complete" : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function BrowseScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [viewMode, setViewMode] = useState<ViewMode>("learn");
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const topInset     = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset  = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarHeight = Platform.OS === "web" ? 84 : 96;

  // Show once-only disclaimer on first visit to the Learn tab.
  useEffect(() => {
    AsyncStorage.getItem(DISCLAIMER_KEY).then((val) => {
      if (!val) setShowDisclaimer(true);
    });
  }, []);

  const dismissDisclaimer = async () => {
    await AsyncStorage.setItem(DISCLAIMER_KEY, "1");
    setShowDisclaimer(false);
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>

      {/* ── Once-only disclaimer modal ── */}
      <Modal visible={showDisclaimer} transparent animationType="fade" statusBarTranslucent>
        <Pressable style={styles.overlay} onPress={dismissDisclaimer}>
          {/* Inner Pressable stops tap-to-dismiss from firing on the card itself */}
          <Pressable style={[styles.disclaimerCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.disclaimerIconRow}>
              <View style={[styles.disclaimerIconBg, { backgroundColor: c.primary + "18" }]}>
                <Ionicons name="school-outline" size={30} color={c.primary} />
              </View>
            </View>
            <Text style={[styles.disclaimerTitle, { color: c.foreground }]}>
              For Refresher Use Only
            </Text>
            <Text style={[styles.disclaimerBody, { color: c.mutedForeground }]}>
              This course is designed as a refresher for already-licensed drivers — it is{" "}
              <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>
                not a substitute for a certified driving school
              </Text>{" "}
              or a qualified instructor.{"\n\n"}
              Traffic fines and road rules shown are based on Kenyan law (NTSA). Verify
              amounts against the latest official NTSA guidelines, as these may change.
            </Text>
            <TouchableOpacity
              style={[styles.disclaimerBtn, { backgroundColor: c.primary }]}
              onPress={dismissDisclaimer}
              activeOpacity={0.85}
            >
              <Text style={styles.disclaimerBtnText}>I Understand</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topInset + 8, backgroundColor: c.background }]}>
        <View style={styles.titleRow}>
          <View style={[styles.viewToggle, { backgroundColor: c.muted }]}>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === "learn" && { backgroundColor: c.card }]}
              onPress={() => setViewMode("learn")}
              activeOpacity={0.8}
            >
              <Ionicons
                name="book-outline"
                size={13}
                color={viewMode === "learn" ? c.primary : c.mutedForeground}
              />
              <Text style={[
                styles.viewBtnLabel,
                { color: viewMode === "learn" ? c.primary : c.mutedForeground },
                viewMode === "learn" && { fontFamily: "Inter_600SemiBold" },
              ]}>
                Learn
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewBtn, viewMode === "fines" && { backgroundColor: c.card }]}
              onPress={() => setViewMode("fines")}
              activeOpacity={0.8}
            >
              <Ionicons
                name="document-text-outline"
                size={13}
                color={viewMode === "fines" ? c.primary : c.mutedForeground}
              />
              <Text style={[
                styles.viewBtnLabel,
                { color: viewMode === "fines" ? c.primary : c.mutedForeground },
                viewMode === "fines" && { fontFamily: "Inter_600SemiBold" },
              ]}>
                Fines
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Content ── */}
      {viewMode === "fines" ? (
        <FinesContent />
      ) : (
        <LearnBrowseView bottomInset={bottomInset} tabBarHeight={tabBarHeight} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12 },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },

  viewToggle: { flexDirection: "row", borderRadius: 12, padding: 3, flex: 1 },
  viewBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 9,
  },
  viewBtnLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // ── Disclaimer modal ──────────────────────────────────────────────────────
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  disclaimerCard: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 14,
  },
  disclaimerIconRow: { alignItems: "center", marginBottom: 2 },
  disclaimerIconBg: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  disclaimerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  disclaimerBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    textAlign: "center",
  },
  disclaimerBtn: {
    marginTop: 4,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  disclaimerBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFF" },

  // ── Learn section ─────────────────────────────────────────────────────────
  learnSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: Platform.OS === "ios" ? 9 : 7,
    gap: 7,
  },
  learnSearchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  learnSearchResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 13,
  },
  learnSearchResultTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  learnSearchResultExcerpt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  learnHeader: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10,
  },
  learnHeaderTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  learnHeaderSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  learnOverallPct: { fontSize: 22, fontFamily: "Inter_700Bold" },

  learnChapter: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderWidth: 1, borderRadius: 16, padding: 16,
  },
  learnChUnit: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  learnChUnitTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },
  learnChTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  learnChSub: { fontSize: 11, fontFamily: "Inter_400Regular" },

  learnProgBg: { height: 5, borderRadius: 3, overflow: "hidden" },
  learnProgFill: { height: 5, borderRadius: 3 },
});
