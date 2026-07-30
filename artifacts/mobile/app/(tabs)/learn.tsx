// Per-tab error boundary — isolates a crash in this tab from the other tabs
// and the navigation shell. Expo Router picks this up automatically.
export { ErrorBoundary } from "@/components/ErrorBoundary";

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
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
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useCourseData, CourseChapter, CourseLesson } from "@/hooks/useCourseData";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { useCourseSearch } from "@/hooks/useCourseSearch";
import { useCourseBookmarks } from "@/hooks/useCourseBookmarks";
import CourseDisclaimerModal from "@/components/CourseDisclaimerModal";
import { SCROLL_PROPS } from "@/lib/scrollProps";

// ── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 44, color }: { pct: number; size?: number; color: string }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * Math.min(1, pct);
  const gap = circumference - filled;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
          borderColor: color + "28",
          alignItems: "center",
          justifyContent: "center",
          position: "absolute",
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
          borderColor: color,
          borderBottomColor: pct < 0.25 ? color + "28" : color,
          borderLeftColor: pct < 0.5 ? color + "28" : color,
          borderTopColor: pct < 0.75 ? color + "28" : color,
          alignItems: "center",
          justifyContent: "center",
          position: "absolute",
          transform: [{ rotate: "-90deg" }],
        }}
      />
      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color }}>
        {Math.round(pct * 100)}%
      </Text>
    </View>
  );
}

// ── Chapter row ──────────────────────────────────────────────────────────────

function ChapterRow({
  chapter,
  completedSlugs,
  onPress,
}: {
  chapter: CourseChapter;
  completedSlugs: Set<string>;
  onPress: (chapter: CourseChapter) => void;
}) {
  const colors = useColors();
  const total = chapter.lessons.length;
  const completed = chapter.lessons.filter((l) => completedSlugs.has(l.slug)).length;
  const pct = total > 0 ? completed / total : 0;
  const totalMin = chapter.lessons.reduce((s, l) => s + (l.estimatedMinutes ?? 0), 0);
  const color = colors.primary;

  return (
    <TouchableOpacity
      style={[styles.chapterRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => onPress(chapter)}
      activeOpacity={0.8}
    >
      <ProgressRing pct={pct} color={color} />
      <View style={styles.chapterMeta}>
        <Text style={[styles.chapterTitle, { color: colors.foreground }]} numberOfLines={2}>
          {chapter.title}
        </Text>
        <Text style={[styles.chapterSub, { color: colors.mutedForeground }]}>
          {total} lesson{total !== 1 ? "s" : ""}
          {totalMin > 0 ? ` · ~${totalMin} min` : ""}
          {completed > 0 ? ` · ${completed}/${total} done` : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ── Jump-in lesson card ───────────────────────────────────────────────────────

function LessonCard({
  lesson,
  chapterTitle,
  completed,
  onPress,
}: {
  lesson: CourseLesson;
  chapterTitle: string;
  completed: boolean;
  onPress: (slug: string) => void;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.lessonCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => onPress(lesson.slug)}
      activeOpacity={0.8}
    >
      {completed && (
        <View style={[styles.completeBadge, { backgroundColor: "#00C853" }]}>
          <Feather name="check" size={10} color="#fff" />
        </View>
      )}
      <Text style={[styles.lessonCardTitle, { color: colors.foreground }]} numberOfLines={2}>
        {lesson.title}
      </Text>
      <Text style={[styles.lessonCardChapter, { color: colors.mutedForeground }]} numberOfLines={1}>
        {chapterTitle}
      </Text>
      {lesson.estimatedMinutes ? (
        <Text style={[styles.lessonCardMin, { color: colors.mutedForeground }]}>
          {lesson.estimatedMinutes} min
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Search result row ─────────────────────────────────────────────────────────

function SearchResultRow({
  slug,
  title,
  excerpt,
  estimatedMinutes,
  onPress,
}: {
  slug: string;
  title: string;
  excerpt: string;
  estimatedMinutes: number;
  onPress: (slug: string) => void;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.searchResultRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => onPress(slug)}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.searchResultTitle, { color: colors.foreground }]} numberOfLines={2}>
          {title}
        </Text>
        {excerpt ? (
          <Text style={[styles.searchResultExcerpt, { color: colors.mutedForeground }]} numberOfLines={2}>
            {excerpt}
          </Text>
        ) : null}
        {estimatedMinutes > 0 ? (
          <View style={styles.searchResultMeta}>
            <Feather name="clock" size={11} color={colors.mutedForeground} />
            <Text style={[styles.searchResultMetaText, { color: colors.mutedForeground }]}>
              ~{estimatedMinutes} min
            </Text>
          </View>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ── Bookmarked lesson row ─────────────────────────────────────────────────────

function BookmarkRow({
  lesson,
  chapterTitle,
  completed,
  onPress,
  onToggle,
}: {
  lesson: CourseLesson;
  chapterTitle: string;
  completed: boolean;
  onPress: (slug: string) => void;
  onToggle: (slug: string) => void;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.bookmarkRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => onPress(lesson.slug)}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.bookmarkTitle, { color: colors.foreground }]} numberOfLines={2}>
          {lesson.title}
        </Text>
        <Text style={[styles.bookmarkChapter, { color: colors.mutedForeground }]} numberOfLines={1}>
          {chapterTitle}
          {completed ? "  ✓" : ""}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => onToggle(lesson.slug)}
        style={styles.bookmarkUnBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="bookmark" size={18} color={colors.primary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LearnScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useApp();

  const { chapters, loading: chaptersLoading, error } = useCourseData();
  const { isCompleted, progress } = useCourseProgress(deviceId);
  const { bookmarks, toggleBookmark } = useCourseBookmarks(deviceId);

  const completedSlugs = useMemo(
    () => new Set(progress.map((p) => p.lessonSlug)),
    [progress]
  );

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarHeight = Platform.OS === "web" ? 84 : 96;

  // Flat list of all lessons for the jump-in grid and search fallback
  const allLessons = useMemo<Array<{ lesson: CourseLesson; chapterTitle: string }>>(() => {
    return chapters.flatMap((ch) =>
      ch.lessons.map((l) => ({ lesson: l, chapterTitle: ch.title }))
    );
  }, [chapters]);

  // Title index for offline search fallback
  const titleIndex = useMemo(
    () => allLessons.map(({ lesson }) => ({ slug: lesson.slug, title: lesson.title })),
    [allLessons]
  );

  const { query, setQuery, results: searchResults, searching } = useCourseSearch(titleIndex);

  // Map bookmarks → lesson objects
  const bookmarkedLessons = useMemo(() => {
    const slugToLesson = new Map(allLessons.map(({ lesson, chapterTitle }) => [lesson.slug, { lesson, chapterTitle }]));
    return bookmarks
      .map((b) => slugToLesson.get(b.lessonSlug))
      .filter((x): x is { lesson: CourseLesson; chapterTitle: string } => !!x);
  }, [bookmarks, allLessons]);

  const handleChapterPress = (chapter: CourseChapter) => {
    const firstIncomplete = chapter.lessons.find((l) => !completedSlugs.has(l.slug));
    const target = firstIncomplete ?? chapter.lessons[0];
    if (target) {
      router.push(`/course/${target.slug}` as any);
    }
  };

  const handleLessonPress = (slug: string) => {
    router.push(`/course/${slug}` as any);
  };

  const isSearchActive = query.trim().length > 0;

  return (
    <CourseDisclaimerModal>
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: topInset + 8, backgroundColor: colors.background }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Learn</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Driving rules &amp; road safety
          </Text>

          {/* Search bar */}
          <View style={[styles.searchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search lessons…"
              placeholderTextColor={colors.mutedForeground}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching && <ActivityIndicator size="small" color={colors.mutedForeground} />}
            {!searching && query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Search results overlay ─────────────────────────────────────── */}
        {isSearchActive ? (
          <ScrollView
            {...SCROLL_PROPS}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomInset + tabBarHeight + 16, gap: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {searching ? (
              <View style={styles.searchStateWrap}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.searchStateText, { color: colors.mutedForeground }]}>Searching…</Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={styles.searchStateWrap}>
                <Feather name="search" size={28} color={colors.mutedForeground} />
                <Text style={[styles.searchStateText, { color: colors.mutedForeground }]}>No results for "{query}"</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.searchCount, { color: colors.mutedForeground }]}>
                  {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                </Text>
                {searchResults.map((r) => (
                  <SearchResultRow
                    key={r.slug}
                    slug={r.slug}
                    title={r.title}
                    excerpt={r.excerpt}
                    estimatedMinutes={r.estimatedMinutes}
                    onPress={handleLessonPress}
                  />
                ))}
              </>
            )}
          </ScrollView>
        ) : chaptersLoading && chapters.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              Loading course…
            </Text>
          </View>
        ) : error && chapters.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load course</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{error}</Text>
          </View>
        ) : chapters.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="book-open" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No content yet</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Course content will appear here once it's available.
            </Text>
          </View>
        ) : (
          <ScrollView
            {...SCROLL_PROPS}
            contentContainerStyle={{
              paddingBottom: bottomInset + tabBarHeight + 16,
              paddingHorizontal: 16,
              gap: 0,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Practice Questions card ── */}
            <TouchableOpacity
              style={[styles.practiceCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
              onPress={() => router.push("/course/quiz/practice" as any)}
              activeOpacity={0.85}
            >
              <View style={[styles.practiceIcon, { backgroundColor: colors.primary + "20" }]}>
                <Feather name="zap" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.practiceTitle, { color: colors.foreground }]}>Practice Questions</Text>
                <Text style={[styles.practiceSub, { color: colors.mutedForeground }]}>
                  Drill quiz questions by chapter or at random
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.primary} />
            </TouchableOpacity>

            {/* ── Section 1: Start from the beginning ── */}
            <View style={styles.sectionHeader}>
              <Feather name="list" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Start from the beginning
              </Text>
            </View>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
              Follow the structured path — opens your next incomplete lesson.
            </Text>

            <View style={{ gap: 10, marginBottom: 28 }}>
              {chapters.map((ch) => (
                <ChapterRow
                  key={ch.id}
                  chapter={ch}
                  completedSlugs={completedSlugs}
                  onPress={handleChapterPress}
                />
              ))}
            </View>

            {/* ── Section 2: Jump to a section ── */}
            <View style={styles.sectionHeader}>
              <Feather name="grid" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Jump to a section
              </Text>
            </View>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
              Tap any lesson to open it directly.
            </Text>

            <View style={styles.lessonGrid}>
              {allLessons.map(({ lesson, chapterTitle }) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  chapterTitle={chapterTitle}
                  completed={completedSlugs.has(lesson.slug)}
                  onPress={handleLessonPress}
                />
              ))}
            </View>

            {/* ── Section 3: Bookmarks (only if any) ── */}
            {bookmarkedLessons.length > 0 && (
              <>
                <View style={[styles.sectionHeader, { marginTop: 28 }]}>
                  <Ionicons name="bookmark" size={16} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                    Bookmarks
                  </Text>
                </View>
                <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
                  Lessons you've saved for quick access.
                </Text>

                <View style={{ gap: 8, marginBottom: 8 }}>
                  {bookmarkedLessons.map(({ lesson, chapterTitle }) => (
                    <BookmarkRow
                      key={lesson.id}
                      lesson={lesson}
                      chapterTitle={chapterTitle}
                      completed={completedSlugs.has(lesson.slug)}
                      onPress={handleLessonPress}
                      onToggle={toggleBookmark}
                    />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </View>
    </CourseDisclaimerModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#00000018",
    gap: 2,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
    marginBottom: 10,
  },
  // Search
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    gap: 8,
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  searchStateWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 10,
  },
  searchStateText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  searchCount: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  searchResultTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  searchResultExcerpt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  searchResultMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  searchResultMetaText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  // Practice card
  practiceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginTop: 16,
    marginBottom: 4,
  },
  practiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  practiceTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  practiceSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 12,
  },
  // Chapter rows
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  chapterMeta: {
    flex: 1,
    gap: 3,
  },
  chapterTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  chapterSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  // Lesson grid
  lessonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  lessonCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    width: "47%",
    gap: 4,
    position: "relative",
  },
  completeBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  lessonCardTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 18,
    paddingRight: 20,
  },
  lessonCardChapter: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  lessonCardMin: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  // Bookmarks
  bookmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  bookmarkTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  bookmarkChapter: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  bookmarkUnBtn: {
    padding: 4,
  },
});
