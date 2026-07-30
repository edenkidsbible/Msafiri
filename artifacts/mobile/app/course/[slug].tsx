import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useCourseData } from "@/hooks/useCourseData";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { apiGet, apiPost, apiDelete, API_BASE } from "@/utils/apiClient";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import { AudioPlayer } from "@/components/AudioPlayer";

// ── Types matching the API response ─────────────────────────────────────────

interface ContentBlock {
  type: "paragraph" | "list" | "callout" | "image";
  text?: string;
  items?: string[];
  path?: string;
  caption?: string;
}

interface FullLesson {
  id: string;
  slug: string;
  chapterId: string;
  title: string;
  order: number;
  estimatedMinutes: number;
  content: ContentBlock[];
  keyPoints: string[];
  quizQuestions: Array<{ id: string }>;
  audioUrl?: string | null;
  createdAt: string;
}

// ── Content block renderer ────────────────────────────────────────────────────

function ContentBlocks({ blocks, colors, onImagePress }: { blocks: ContentBlock[]; colors: ReturnType<typeof useColors>; onImagePress: (uri: string) => void }) {
  return (
    <View style={{ gap: 14 }}>
      {blocks.map((block, i) => {
        if (block.type === "paragraph") {
          return (
            <Text key={i} style={[styles.paragraph, { color: colors.foreground }]}>
              {block.text}
            </Text>
          );
        }
        if (block.type === "list" && block.items?.length) {
          return (
            <View key={i} style={{ gap: 6 }}>
              {block.items.map((item, j) => (
                <View key={j} style={styles.bulletRow}>
                  <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.bulletText, { color: colors.foreground }]}>{item}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (block.type === "callout") {
          return (
            <View key={i} style={[styles.callout, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "40" }]}>
              <Feather name="info" size={16} color={colors.primary} style={{ marginTop: 2 }} />
              <Text style={[styles.calloutText, { color: colors.foreground }]}>{block.text}</Text>
            </View>
          );
        }
        if (block.type === "image" && block.path) {
          const uri = `${API_BASE}/course-images/${block.path}`;
          const screenWidth = Dimensions.get("window").width;
          return (
            <TouchableOpacity key={i} style={styles.imageBlock} onPress={() => onImagePress(uri)} activeOpacity={0.88}>
              <Image
                source={{ uri }}
                style={[styles.lessonImage, { width: screenWidth - 48 }]}
                resizeMode="contain"
              />
              {block.caption && block.caption !== "Illustration" && (
                <Text style={[styles.imageCaption, { color: colors.mutedForeground }]}>
                  {block.caption}
                </Text>
              )}
              <View style={styles.expandHint}>
                <Ionicons name="expand-outline" size={13} color={colors.mutedForeground} />
                <Text style={[styles.expandHintTxt, { color: colors.mutedForeground }]}>Tap to expand</Text>
              </View>
            </TouchableOpacity>
          );
        }
        return null;
      })}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LessonReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { deviceId } = useApp();

  const { chapters } = useCourseData();
  const { isCompleted, markComplete } = useCourseProgress(deviceId);

  const [lesson, setLesson] = useState<FullLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  // ── Derive flat lesson list for prev/next navigation ─────────────────────
  const allLessons = useMemo(
    () => chapters.flatMap((ch) => ch.lessons),
    [chapters]
  );

  const currentIdx = useMemo(
    () => allLessons.findIndex((l) => l.slug === slug),
    [allLessons, slug]
  );

  const prevLesson = currentIdx > 0 ? allLessons[currentIdx - 1] : null;
  const nextLesson = currentIdx >= 0 && currentIdx < allLessons.length - 1 ? allLessons[currentIdx + 1] : null;

  const chapterTitle = useMemo(() => {
    if (!lesson) return "";
    return chapters.find((ch) => ch.id === lesson.chapterId)?.title ?? "";
  }, [lesson, chapters]);

  // ── Fetch full lesson with offline cache ─────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setLesson(null);

    const cacheKey = `course_lesson_${slug}`;

    // 1. Try cache first so the lesson renders instantly
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (raw) {
          try {
            const cached: FullLesson = JSON.parse(raw);
            setLesson(cached);
            setLoading(false);
          } catch { /* ignore parse error */ }
        }
      })
      .catch(() => {});

    // 2. Fetch fresh from API; update cache and state
    apiGet<FullLesson>(`/course/lessons/${encodeURIComponent(slug)}`)
      .then((data) => {
        setLesson(data);
        // Write to cache (fire-and-forget)
        AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
      })
      .catch((err) => {
        // Only surface error if we didn't already load from cache
        setLesson((prev) => {
          if (!prev) setError(err?.message ?? "Failed to load lesson");
          return prev;
        });
      })
      .finally(() => setLoading(false));
  }, [slug]);

  // ── Fetch bookmark status ─────────────────────────────────────────────────
  useEffect(() => {
    if (!deviceId || !slug) return;
    apiGet<{ bookmarks: Array<{ lessonSlug: string }> }>(
      `/course/bookmarks?deviceId=${encodeURIComponent(deviceId)}`
    )
      .then((data) => {
        setBookmarked((data.bookmarks ?? []).some((b) => b.lessonSlug === slug));
      })
      .catch(() => {});
  }, [deviceId, slug]);

  // ── Bookmark toggle ───────────────────────────────────────────────────────
  const toggleBookmark = useCallback(async () => {
    if (!deviceId || !slug || bookmarkLoading) return;
    setBookmarkLoading(true);
    const wasBookmarked = bookmarked;
    setBookmarked(!wasBookmarked);
    try {
      if (wasBookmarked) {
        await apiDelete("/course/bookmarks", { deviceId, lessonSlug: slug });
      } else {
        await apiPost("/course/bookmarks", { deviceId, lessonSlug: slug });
      }
    } catch {
      setBookmarked(wasBookmarked); // revert on failure
    } finally {
      setBookmarkLoading(false);
    }
  }, [deviceId, slug, bookmarked, bookmarkLoading]);

  // ── Mark complete ─────────────────────────────────────────────────────────
  const handleComplete = useCallback(async () => {
    if (!slug || completing) return;
    setCompleting(true);
    try {
      await markComplete(slug);
    } finally {
      setCompleting(false);
    }
  }, [slug, completing, markComplete]);

  const navigateTo = (targetSlug: string) => {
    router.replace(`/course/${targetSlug}` as any);
  };

  const topInset = Platform.OS === "ios" ? insets.top : Platform.OS === "web" ? 0 : insets.top;
  const bottomInset = Platform.OS === "web" ? 24 : insets.bottom;

  const completed = !!slug && isCompleted(slug);
  const hasQuiz = (lesson?.quizQuestions?.length ?? 0) > 0;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !lesson) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <View style={styles.centerFill}>
          <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>
            {error ?? "Lesson not found"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          {chapterTitle ? (
            <Text style={[styles.breadcrumb, { color: colors.mutedForeground }]} numberOfLines={1}>
              {chapterTitle}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity style={styles.bookmarkBtn} onPress={toggleBookmark} disabled={bookmarkLoading}>
          <Ionicons
            name={bookmarked ? "bookmark" : "bookmark-outline"}
            size={22}
            color={bookmarked ? colors.primary : colors.foreground}
          />
        </TouchableOpacity>
      </View>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomInset + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text style={[styles.title, { color: colors.foreground }]}>{lesson.title}</Text>

        {/* Meta */}
        <View style={styles.metaRow}>
          {lesson.estimatedMinutes ? (
            <View style={styles.metaItem}>
              <Feather name="clock" size={13} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                ~{lesson.estimatedMinutes} min
              </Text>
            </View>
          ) : null}
          {completed && (
            <View style={[styles.completedPill, { backgroundColor: "#00C85320" }]}>
              <Feather name="check-circle" size={12} color="#00C853" />
              <Text style={[styles.completedText, { color: "#00C853" }]}>Completed</Text>
            </View>
          )}
        </View>

        {/* Audio player — shown only when audio is available for this lesson */}
        {lesson.audioUrl ? (
          <AudioPlayer audioUrl={`${API_BASE}${lesson.audioUrl}`} />
        ) : null}

        {/* Content blocks */}
        {lesson.content?.length ? (
          <ContentBlocks blocks={lesson.content} colors={colors} onImagePress={setExpandedImage} />
        ) : (
          <Text style={[styles.paragraph, { color: colors.mutedForeground }]}>
            No content available for this lesson.
          </Text>
        )}

        {/* Key points card */}
        {lesson.keyPoints?.length ? (
          <View style={[styles.keyPointsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.keyPointsHeader}>
              <Feather name="star" size={15} color={colors.primary} />
              <Text style={[styles.keyPointsTitle, { color: colors.foreground }]}>Key points</Text>
            </View>
            {lesson.keyPoints.map((point, i) => (
              <View key={i} style={styles.keyPointRow}>
                <View style={[styles.keyPointDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.keyPointText, { color: colors.foreground }]}>{point}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Complete CTA / Quiz CTA */}
        {!completed ? (
          hasQuiz ? (
            <TouchableOpacity
              style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push(`/course/quiz/${slug}` as any)}
              activeOpacity={0.85}
            >
              <Feather name="help-circle" size={18} color="#fff" />
              <Text style={styles.ctaBtnText}>Start lesson quiz</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
              onPress={handleComplete}
              disabled={completing}
              activeOpacity={0.85}
            >
              {completing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="check-circle" size={18} color="#fff" />
                  <Text style={styles.ctaBtnText}>Mark as complete</Text>
                </>
              )}
            </TouchableOpacity>
          )
        ) : (
          <View style={{ gap: 10 }}>
            <View style={[styles.completedCta, { backgroundColor: "#00C85315", borderColor: "#00C85340" }]}>
              <Feather name="check-circle" size={18} color="#00C853" />
              <Text style={[styles.completedCtaText, { color: "#00C853" }]}>Lesson completed</Text>
            </View>
            {hasQuiz && (
              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => router.push(`/course/quiz/${slug}` as any)}
                activeOpacity={0.85}
              >
                <Feather name="refresh-cw" size={16} color={colors.foreground} />
                <Text style={[styles.ctaBtnText, { color: colors.foreground }]}>Retake quiz</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Prev / Next navigation */}
        <View style={styles.navRow}>
          {prevLesson ? (
            <TouchableOpacity
              style={[styles.navBtn, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}
              onPress={() => navigateTo(prevLesson.slug)}
              activeOpacity={0.8}
            >
              <Feather name="chevron-left" size={16} color={colors.foreground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.navLabel, { color: colors.mutedForeground }]}>Previous</Text>
                <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={2}>
                  {prevLesson.title}
                </Text>
              </View>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}

          {nextLesson ? (
            <TouchableOpacity
              style={[styles.navBtn, { backgroundColor: colors.card, borderColor: colors.border, flex: 1, alignItems: "flex-end" }]}
              onPress={() => navigateTo(nextLesson.slug)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={[styles.navLabel, { color: colors.mutedForeground }]}>Next</Text>
                <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={2}>
                  {nextLesson.title}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.foreground} />
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
        </View>
      </ScrollView>

      {/* ── Full-screen image viewer ───────────────────────────────────── */}
      <Modal visible={!!expandedImage} transparent animationType="fade" onRequestClose={() => setExpandedImage(null)}>
        <StatusBar hidden />
        <Pressable style={styles.imageModal} onPress={() => setExpandedImage(null)}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.imageModalInner}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            pinchGestureEnabled
          >
            {expandedImage && (
              <Image
                source={{ uri: expandedImage }}
                style={styles.imageModalImg}
                resizeMode="contain"
              />
            )}
          </ScrollView>
          <TouchableOpacity style={styles.imageModalClose} onPress={() => setExpandedImage(null)} activeOpacity={0.8}>
            <Ionicons name="close" size={20} color="#FFF" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
  },
  topBarCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  breadcrumb: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  bookmarkBtn: {
    padding: 8,
    borderRadius: 8,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 18,
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    lineHeight: 30,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  completedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  completedText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 24,
    fontFamily: "Inter_400Regular",
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 9,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
    fontFamily: "Inter_400Regular",
  },
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  calloutText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  imageBlock: {
    alignItems: "center",
    gap: 6,
  },
  lessonImage: {
    height: 260,
    borderRadius: 10,
  },
  imageCaption: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  expandHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  expandHintTxt: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  imageModal: {
    flex: 1,
    backgroundColor: "#000",
  },
  imageModalInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imageModalImg: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
  },
  imageModalClose: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  keyPointsCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  keyPointsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  keyPointsTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  keyPointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  keyPointDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    flexShrink: 0,
  },
  keyPointText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
  },
  quizPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  quizPromptText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
  },
  ctaBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  completedCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
  },
  completedCtaText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  navRow: {
    flexDirection: "row",
    gap: 10,
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  navLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginBottom: 2,
  },
  navTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 18,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  errorText: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
