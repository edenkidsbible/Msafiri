import React, { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
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
import CourseDisclaimerModal from "@/components/CourseDisclaimerModal";
import { SCROLL_PROPS, FLAT_LIST_PROPS } from "@/lib/scrollProps";

// ── Progress ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 44, color }: { pct: number; size?: number; color: string }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * Math.min(1, pct);
  const gap = circumference - filled;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* SVG-style ring via View trick (native-compatible) */}
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

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LearnScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deviceId } = useApp();

  const { chapters, loading: chaptersLoading, error } = useCourseData();
  const { isCompleted, progress } = useCourseProgress(deviceId);

  const completedSlugs = useMemo(
    () => new Set(progress.map((p) => p.lessonSlug)),
    [progress]
  );

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const tabBarHeight = Platform.OS === "web" ? 84 : 96;

  // Flat list of all lessons for the jump-in grid
  const allLessons = useMemo<Array<{ lesson: CourseLesson; chapterTitle: string }>>(() => {
    return chapters.flatMap((ch) =>
      ch.lessons.map((l) => ({ lesson: l, chapterTitle: ch.title }))
    );
  }, [chapters]);

  const handleChapterPress = (chapter: CourseChapter) => {
    // Open first incomplete lesson, or first lesson if all done
    const firstIncomplete = chapter.lessons.find((l) => !completedSlugs.has(l.slug));
    const target = firstIncomplete ?? chapter.lessons[0];
    if (target) {
      router.push(`/course/${target.slug}` as any);
    }
  };

  const handleLessonPress = (slug: string) => {
    router.push(`/course/${slug}` as any);
  };

  return (
    <CourseDisclaimerModal>
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: topInset + 8, backgroundColor: colors.background }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Learn</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Driving rules &amp; road safety
          </Text>
        </View>

        {chaptersLoading && chapters.length === 0 ? (
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
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  headerSub: {
    fontSize: 13,
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
});
