/**
 * Standalone practice quiz bank.
 * Loads all cached lessons from AsyncStorage, extracts their quiz questions,
 * shuffles them (or filters by chapter), and delegates to the quiz UI in [slug].tsx.
 * Results are shown at the end but NOT submitted to the progress API.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useCourseData } from "@/hooks/useCourseData";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import type { QuizQuestion } from "./[slug]";

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = "all" | "chapter" | "random";
type Phase = "pick" | "question" | "feedback" | "results";

interface CachedLesson {
  id: string;
  slug: string;
  chapterId: string;
  title: string;
  quizQuestions: QuizQuestion[];
}

// ── Option card (same appearance as main quiz) ────────────────────────────────

function OptionCard({
  text,
  index,
  selected,
  correct,
  showResult,
  onPress,
  colors,
}: {
  text: string;
  index: number;
  selected: boolean;
  correct: boolean;
  showResult: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  let bg = colors.card;
  let border = colors.border;
  let textColor = colors.foreground;

  if (showResult) {
    if (correct) { bg = "#00C85318"; border = "#00C853"; }
    else if (selected && !correct) { bg = "#FF3B3018"; border = "#FF3B30"; }
  } else if (selected) {
    bg = colors.primary + "18";
    border = colors.primary;
  }

  const labels = ["A", "B", "C", "D"];

  return (
    <TouchableOpacity
      style={[styles.optionCard, { backgroundColor: bg, borderColor: border }]}
      onPress={onPress}
      disabled={showResult}
      activeOpacity={0.8}
    >
      <View style={[styles.optionLabel, { backgroundColor: showResult && correct ? "#00C853" : selected && !showResult ? colors.primary : colors.muted }]}>
        <Text style={[styles.optionLabelText, { color: showResult && correct ? "#fff" : selected && !showResult ? "#fff" : colors.mutedForeground }]}>
          {labels[index] ?? String(index + 1)}
        </Text>
      </View>
      <Text style={[styles.optionText, { color: textColor }]}>{text}</Text>
      {showResult && correct && <Feather name="check-circle" size={18} color="#00C853" style={{ marginLeft: "auto" }} />}
      {showResult && selected && !correct && <Feather name="x-circle" size={18} color="#FF3B30" style={{ marginLeft: "auto" }} />}
    </TouchableOpacity>
  );
}

// ── Shuffle helper ────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function PracticeQuizScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { chapters } = useCourseData();

  const topInset = Platform.OS === "ios" ? insets.top : insets.top;
  const bottomInset = Platform.OS === "web" ? 24 : insets.bottom;

  // ── Load cached lessons from AsyncStorage ────────────────────────────────
  const [cachedLessons, setCachedLessons] = useState<CachedLesson[]>([]);
  const [cacheLoading, setCacheLoading] = useState(true);

  useEffect(() => {
    async function loadCache() {
      const allSlugs = chapters.flatMap((ch) => ch.lessons.map((l) => l.slug));
      const loaded: CachedLesson[] = [];
      await Promise.all(
        allSlugs.map(async (slug) => {
          try {
            const raw = await AsyncStorage.getItem(`course_lesson_${slug}`);
            if (raw) {
              const parsed: CachedLesson = JSON.parse(raw);
              if (parsed.quizQuestions?.length) loaded.push(parsed);
            }
          } catch { /* ignore */ }
        })
      );
      setCachedLessons(loaded);
      setCacheLoading(false);
    }
    if (chapters.length > 0) loadCache();
    else setCacheLoading(false);
  }, [chapters]);

  // ── Mode selection ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("pick");
  const [mode, setMode] = useState<Mode>("all");
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);

  // ── Active question set ───────────────────────────────────────────────────
  const [activeQuestions, setActiveQuestions] = useState<Array<QuizQuestion & { lessonTitle: string }>>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [quizPhase, setQuizPhase] = useState<"question" | "feedback">("question");

  const allQuestions = useMemo(() => {
    return cachedLessons.flatMap((l) =>
      l.quizQuestions.map((q) => ({ ...q, lessonTitle: l.title }))
    );
  }, [cachedLessons]);

  const questionsForChapter = useCallback(
    (chapterId: string) => {
      const slugs = new Set(
        chapters.find((c) => c.id === chapterId)?.lessons.map((l) => l.slug) ?? []
      );
      return cachedLessons
        .filter((l) => slugs.has(l.slug))
        .flatMap((l) => l.quizQuestions.map((q) => ({ ...q, lessonTitle: l.title })));
    },
    [cachedLessons, chapters]
  );

  const startQuiz = useCallback(
    (m: Mode, chapterId?: string) => {
      let qs: Array<QuizQuestion & { lessonTitle: string }>;
      if (m === "all") {
        qs = shuffle(allQuestions);
      } else if (m === "chapter" && chapterId) {
        qs = shuffle(questionsForChapter(chapterId));
      } else {
        qs = shuffle(allQuestions).slice(0, 10);
      }

      if (qs.length === 0) return;
      setActiveQuestions(qs);
      setCurrentIndex(0);
      setSelectedIndex(null);
      setAnswers([]);
      setQuizPhase("question");
      setPhase("question");
    },
    [allQuestions, questionsForChapter]
  );

  const handleSubmit = () => {
    if (selectedIndex === null) return;
    const newAnswers = [...answers];
    newAnswers[currentIndex] = selectedIndex;
    setAnswers(newAnswers);
    setQuizPhase("feedback");
  };

  const handleNext = () => {
    const isLast = currentIndex === activeQuestions.length - 1;
    if (isLast) {
      setPhase("results");
    } else {
      setCurrentIndex((prev) => prev + 1);
      setSelectedIndex(null);
      setQuizPhase("question");
    }
  };

  const handleRetake = () => {
    startQuiz(mode, selectedChapterId ?? undefined);
  };

  // ── Results ───────────────────────────────────────────────────────────────
  if (phase === "results") {
    const score = answers.filter((a, i) => a === activeQuestions[i]?.correctIndex).length;
    const total = activeQuestions.length;
    const pct = total > 0 ? score / total : 0;
    const passed = pct >= 0.7;
    const passColor = passed ? "#00C853" : "#FF3B30";
    const passBg = passed ? "#00C85318" : "#FF3B3018";
    const passBorder = passed ? "#00C85340" : "#FF3B3040";

    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setPhase("pick")}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Practice Results</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView {...SCROLL_PROPS} contentContainerStyle={[styles.resultsContent, { paddingBottom: bottomInset + 40 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.scoreCircleWrap}>
            <View style={[styles.scoreCircle, { borderColor: passColor + "60", backgroundColor: passBg }]}>
              <Text style={[styles.scoreNum, { color: passColor }]}>{score}/{total}</Text>
              <Text style={[styles.scoreLabel, { color: passColor }]}>correct</Text>
            </View>
          </View>

          <View style={[styles.passBadge, { backgroundColor: passBg, borderColor: passBorder }]}>
            <Feather name={passed ? "award" : "refresh-cw"} size={18} color={passColor} />
            <Text style={[styles.passBadgeText, { color: passColor }]}>
              {passed ? "Great practice session!" : "Keep drilling — you'll get there!"}
            </Text>
          </View>

          <Text style={[styles.practiceNote, { color: colors.mutedForeground }]}>
            Practice results are not saved to your progress.
          </Text>

          <View style={[styles.scoreBarTrack, { backgroundColor: colors.muted }]}>
            <View style={[styles.scoreBarFill, { backgroundColor: passColor, width: `${Math.round(pct * 100)}%` as any }]} />
          </View>
          <Text style={[styles.scoreBarLabel, { color: colors.mutedForeground }]}>
            {Math.round(pct * 100)}%
          </Text>

          <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: colors.primary }]} onPress={handleRetake} activeOpacity={0.85}>
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.ctaBtnText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => setPhase("pick")} activeOpacity={0.85}>
            <Feather name="list" size={16} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Change mode</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.replace("/(tabs)/learn" as any)} activeOpacity={0.85}>
            <Feather name="book-open" size={16} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Back to Learn</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Active quiz ───────────────────────────────────────────────────────────
  if (phase === "question" || phase === "feedback") {
    const currentQ = activeQuestions[currentIndex];
    const showResult = quizPhase === "feedback";
    const isCorrect = selectedIndex === currentQ?.correctIndex;
    const isLast = currentIndex === activeQuestions.length - 1;

    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setPhase("pick")}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Practice Quiz</Text>
          <Text style={[styles.progressCount, { color: colors.mutedForeground }]}>
            {currentIndex + 1}/{activeQuestions.length}
          </Text>
        </View>

        <View style={[styles.progressBarTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.progressBarFill, { backgroundColor: colors.primary, width: `${((currentIndex + (showResult ? 1 : 0)) / activeQuestions.length) * 100}%` as any }]} />
        </View>

        <ScrollView {...SCROLL_PROPS} contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
          {currentQ.lessonTitle ? (
            <Text style={[styles.lessonRef, { color: colors.mutedForeground }]}>
              From: {currentQ.lessonTitle}
            </Text>
          ) : null}
          <Text style={[styles.questionNum, { color: colors.mutedForeground }]}>
            Question {currentIndex + 1} of {activeQuestions.length}
          </Text>
          <Text style={[styles.questionText, { color: colors.foreground }]}>
            {currentQ.question}
          </Text>

          <View style={styles.optionsGap}>
            {currentQ.options.map((opt, i) => (
              <OptionCard
                key={i}
                text={opt}
                index={i}
                selected={selectedIndex === i}
                correct={i === currentQ.correctIndex}
                showResult={showResult}
                onPress={() => !showResult && setSelectedIndex(i)}
                colors={colors}
              />
            ))}
          </View>

          {showResult && (
            <View style={[styles.feedbackBanner, { backgroundColor: isCorrect ? "#00C85318" : "#FF3B3018", borderColor: isCorrect ? "#00C85340" : "#FF3B3040" }]}>
              <Feather name={isCorrect ? "check-circle" : "x-circle"} size={20} color={isCorrect ? "#00C853" : "#FF3B30"} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.feedbackTitle, { color: isCorrect ? "#00C853" : "#FF3B30" }]}>
                  {isCorrect ? "Correct!" : "Not quite"}
                </Text>
                {!isCorrect && (
                  <Text style={[styles.feedbackBody, { color: colors.mutedForeground }]}>
                    Correct: {currentQ.options[currentQ.correctIndex]}
                  </Text>
                )}
                <Text style={[styles.feedbackRef, { color: colors.mutedForeground }]}>
                  See: {currentQ.lessonTitle}
                </Text>
              </View>
            </View>
          )}

          {quizPhase === "question" ? (
            <TouchableOpacity
              style={[styles.ctaBtn, { backgroundColor: selectedIndex !== null ? colors.primary : colors.muted }]}
              onPress={handleSubmit}
              disabled={selectedIndex === null}
              activeOpacity={0.85}
            >
              <Text style={[styles.ctaBtnText, { color: selectedIndex !== null ? "#fff" : colors.mutedForeground }]}>
                Submit answer
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: colors.primary }]} onPress={handleNext} activeOpacity={0.85}>
              <Text style={styles.ctaBtnText}>{isLast ? "See results" : "Next question"}</Text>
              <Feather name={isLast ? "award" : "arrow-right"} size={16} color="#fff" />
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── Mode picker ───────────────────────────────────────────────────────────
  const hasQuestions = allQuestions.length > 0;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Practice Questions</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView {...SCROLL_PROPS} contentContainerStyle={[styles.pickerContent, { paddingBottom: bottomInset + 40 }]} showsVerticalScrollIndicator={false}>
        {cacheLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading questions…</Text>
          </View>
        ) : !hasQuestions ? (
          <View style={styles.emptyWrap}>
            <Feather name="inbox" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No questions cached yet</Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Open a lesson first to cache its content, then come back to practise its quiz questions.
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Choose a practice mode</Text>
            <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
              {allQuestions.length} question{allQuestions.length !== 1 ? "s" : ""} available from {cachedLessons.length} lesson{cachedLessons.length !== 1 ? "s" : ""}
            </Text>

            {/* All questions */}
            <TouchableOpacity
              style={[styles.modeCard, { backgroundColor: colors.card, borderColor: mode === "all" ? colors.primary : colors.border }]}
              onPress={() => { setMode("all"); setSelectedChapterId(null); startQuiz("all"); }}
              activeOpacity={0.8}
            >
              <View style={[styles.modeIcon, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="layers" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeTitle, { color: colors.foreground }]}>All questions</Text>
                <Text style={[styles.modeSub, { color: colors.mutedForeground }]}>
                  {allQuestions.length} questions shuffled
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>

            {/* Random 10 */}
            <TouchableOpacity
              style={[styles.modeCard, { backgroundColor: colors.card, borderColor: mode === "random" ? colors.primary : colors.border }]}
              onPress={() => { setMode("random"); setSelectedChapterId(null); startQuiz("random"); }}
              activeOpacity={0.8}
            >
              <View style={[styles.modeIcon, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="shuffle" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeTitle, { color: colors.foreground }]}>Random 10</Text>
                <Text style={[styles.modeSub, { color: colors.mutedForeground }]}>
                  Quick 10-question drill
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>

            {/* By chapter */}
            {chapters.length > 0 && (
              <>
                <Text style={[styles.chapterPickerLabel, { color: colors.mutedForeground }]}>By chapter</Text>
                {chapters.map((ch) => {
                  const count = questionsForChapter(ch.id).length;
                  if (count === 0) return null;
                  return (
                    <TouchableOpacity
                      key={ch.id}
                      style={[styles.modeCard, { backgroundColor: colors.card, borderColor: selectedChapterId === ch.id ? colors.primary : colors.border }]}
                      onPress={() => { setMode("chapter"); setSelectedChapterId(ch.id); startQuiz("chapter", ch.id); }}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.modeIcon, { backgroundColor: colors.primary + "18" }]}>
                        <Feather name="book" size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.modeTitle, { color: colors.foreground }]} numberOfLines={2}>{ch.title}</Text>
                        <Text style={[styles.modeSub, { color: colors.mutedForeground }]}>{count} question{count !== 1 ? "s" : ""}</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </>
        )}
      </ScrollView>
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
  backBtn: { padding: 8, borderRadius: 8 },
  topBarTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center", paddingHorizontal: 4 },
  progressCount: { fontSize: 13, fontFamily: "Inter_400Regular", minWidth: 38, textAlign: "right" },
  progressBarTrack: { height: 3, width: "100%" },
  progressBarFill: { height: 3, borderRadius: 2 },
  pickerContent: { paddingHorizontal: 20, paddingTop: 24, gap: 12 },
  pickerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 2 },
  pickerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  modeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  modeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modeSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  chapterPickerLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 2 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  lessonRef: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  questionNum: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  questionText: { fontSize: 18, fontFamily: "Inter_700Bold", lineHeight: 26 },
  optionsGap: { gap: 10 },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
  },
  optionLabel: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  optionLabelText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  optionText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  feedbackBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  feedbackTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 2 },
  feedbackBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 4 },
  feedbackRef: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  ctaBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, minHeight: 200 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, minHeight: 300, paddingHorizontal: 16 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  // Results
  resultsContent: { paddingHorizontal: 24, paddingTop: 32, alignItems: "center", gap: 16 },
  scoreCircleWrap: { alignItems: "center", marginBottom: 8 },
  scoreCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  scoreNum: { fontSize: 28, fontFamily: "Inter_700Bold" },
  scoreLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  passBadge: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  passBadgeText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  practiceNote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  scoreBarTrack: { width: "100%", height: 8, borderRadius: 4, overflow: "hidden" },
  scoreBarFill: { height: 8, borderRadius: 4 },
  scoreBarLabel: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
