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
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useCourseProgress } from "@/hooks/useCourseProgress";
import { SCROLL_PROPS } from "@/lib/scrollProps";

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  lessonId: string;
  question: string;
  options: string[];
  correctIndex: number;
  order: number;
}

interface FullLesson {
  id: string;
  slug: string;
  title: string;
  quizQuestions: QuizQuestion[];
}

type Phase = "question" | "feedback" | "results";

interface SavedProgress {
  currentIndex: number;
  answers: (number | null)[];
}

function progressKey(slug: string) {
  return `quiz_progress_${slug}`;
}

// ── Answer option card ────────────────────────────────────────────────────────

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
    if (correct) {
      bg = "#00C85318";
      border = "#00C853";
      textColor = colors.foreground;
    } else if (selected && !correct) {
      bg = "#FF3B3018";
      border = "#FF3B30";
      textColor = colors.foreground;
    }
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
      {showResult && correct && (
        <Feather name="check-circle" size={18} color="#00C853" style={{ marginLeft: "auto" }} />
      )}
      {showResult && selected && !correct && (
        <Feather name="x-circle" size={18} color="#FF3B30" style={{ marginLeft: "auto" }} />
      )}
    </TouchableOpacity>
  );
}

// ── Results screen ────────────────────────────────────────────────────────────

function ResultsScreen({
  score,
  total,
  lessonTitle,
  lessonSlug,
  isPractice,
  onRetake,
  colors,
  insets,
}: {
  score: number;
  total: number;
  lessonTitle: string;
  lessonSlug: string;
  isPractice: boolean;
  onRetake: () => void;
  colors: ReturnType<typeof useColors>;
  insets: { top: number; bottom: number };
}) {
  const router = useRouter();
  const pct = total > 0 ? score / total : 0;
  const passed = pct >= 0.7;
  const passBg = passed ? "#00C85318" : "#FF3B3018";
  const passColor = passed ? "#00C853" : "#FF3B30";
  const passBorder = passed ? "#00C85340" : "#FF3B3040";
  const topInset = Platform.OS === "ios" ? insets.top : insets.top;
  const bottomInset = Platform.OS === "web" ? 24 : insets.bottom;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Quiz Results</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={[styles.resultsContent, { paddingBottom: bottomInset + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Score circle */}
        <View style={styles.scoreCircleWrap}>
          <View style={[styles.scoreCircle, { borderColor: passColor + "60", backgroundColor: passBg }]}>
            <Text style={[styles.scoreNum, { color: passColor }]}>{score}/{total}</Text>
            <Text style={[styles.scoreLabel, { color: passColor }]}>correct</Text>
          </View>
        </View>

        {/* Pass/fail badge */}
        <View style={[styles.passBadge, { backgroundColor: passBg, borderColor: passBorder }]}>
          <Feather name={passed ? "award" : "refresh-cw"} size={18} color={passColor} />
          <Text style={[styles.passBadgeText, { color: passColor }]}>
            {passed ? "Great job — you passed!" : "Keep practising — almost there!"}
          </Text>
        </View>

        <Text style={[styles.lessonTitleSmall, { color: colors.mutedForeground }]}>
          {lessonTitle}
        </Text>

        {/* Score bar */}
        <View style={[styles.scoreBarTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.scoreBarFill, { backgroundColor: passColor, width: `${Math.round(pct * 100)}%` as any }]} />
        </View>
        <Text style={[styles.scoreBarLabel, { color: colors.mutedForeground }]}>
          {Math.round(pct * 100)}% · {passed ? "Passed" : "Not passed"} (70% to pass)
        </Text>

        {/* CTAs */}
        <TouchableOpacity
          style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
          onPress={onRetake}
          activeOpacity={0.85}
        >
          <Feather name="refresh-cw" size={16} color="#fff" />
          <Text style={styles.ctaBtnText}>Retake quiz</Text>
        </TouchableOpacity>

        {!isPractice && (
          <TouchableOpacity
            style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.replace(`/course/${lessonSlug}` as any)}
            activeOpacity={0.85}
          >
            <Feather name="arrow-left" size={16} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Back to lesson</Text>
          </TouchableOpacity>
        )}

        {isPractice && (
          <TouchableOpacity
            style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.replace("/(tabs)/learn" as any)}
            activeOpacity={0.85}
          >
            <Feather name="book-open" size={16} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Back to Learn</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

// ── Resume prompt ─────────────────────────────────────────────────────────────

function ResumePrompt({
  currentIndex,
  total,
  colors,
  insets,
  onResume,
  onStartFresh,
}: {
  currentIndex: number;
  total: number;
  colors: ReturnType<typeof useColors>;
  insets: { top: number; bottom: number };
  onResume: () => void;
  onStartFresh: () => void;
}) {
  const topInset = insets.top;
  const bottomInset = Platform.OS === "web" ? 24 : insets.bottom;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={{ width: 38 }} />
        <Text style={[styles.topBarTitle, { color: colors.foreground }]}>Lesson Quiz</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={[styles.centerFill, { paddingBottom: bottomInset + 24 }]}>
        <View style={[styles.resumeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.resumeIconWrap, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="bookmark" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.resumeTitle, { color: colors.foreground }]}>
            Resume your quiz?
          </Text>
          <Text style={[styles.resumeBody, { color: colors.mutedForeground }]}>
            You were on question {currentIndex + 1} of {total}. Pick up where you left off, or start over.
          </Text>

          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
            onPress={onResume}
            activeOpacity={0.85}
          >
            <Feather name="play" size={16} color="#fff" />
            <Text style={styles.ctaBtnText}>Resume</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 0 }]}
            onPress={onStartFresh}
            activeOpacity={0.85}
          >
            <Feather name="refresh-cw" size={16} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Start fresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── Main quiz screen ──────────────────────────────────────────────────────────

export default function QuizScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug, practice } = useLocalSearchParams<{ slug: string; practice?: string }>();
  const isPractice = practice === "1";

  const { deviceId } = useApp();
  const { markComplete } = useCourseProgress(deviceId);

  const [lesson, setLesson] = useState<FullLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quiz state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("question");
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [submitted, setSubmitting] = useState(false);

  // Resume prompt state
  const [savedProgress, setSavedProgress] = useState<SavedProgress | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  // Load lesson from AsyncStorage cache, then check for saved progress
  useEffect(() => {
    if (!slug) return;
    const cacheKey = `course_lesson_${slug}`;
    AsyncStorage.getItem(cacheKey)
      .then(async (raw) => {
        if (raw) {
          const parsed: FullLesson = JSON.parse(raw);
          setLesson(parsed);

          // Check for saved in-progress session
          try {
            const savedRaw = await AsyncStorage.getItem(progressKey(slug));
            if (savedRaw) {
              const saved: SavedProgress = JSON.parse(savedRaw);
              // Only offer resume if there's meaningful progress (answered at least one question)
              if (saved.answers.some((a) => a !== null)) {
                setSavedProgress(saved);
                setShowResumePrompt(true);
              } else {
                // Stale/empty save — clear it silently
                await AsyncStorage.removeItem(progressKey(slug));
              }
            }
          } catch {
            // Ignore errors reading saved progress
          }
        } else {
          setError("Quiz not available offline. Please open the lesson first.");
        }
      })
      .catch(() => setError("Failed to load quiz questions."))
      .finally(() => setLoading(false));
  }, [slug]);

  const questions = useMemo(() => lesson?.quizQuestions ?? [], [lesson]);
  const currentQ = questions[currentIndex];

  // Persist progress to AsyncStorage after each answer
  const persistProgress = useCallback(
    async (index: number, newAnswers: (number | null)[]) => {
      if (!slug) return;
      try {
        const data: SavedProgress = { currentIndex: index, answers: newAnswers };
        await AsyncStorage.setItem(progressKey(slug), JSON.stringify(data));
      } catch {
        // Non-critical — ignore storage errors
      }
    },
    [slug]
  );

  // Clear persisted progress
  const clearProgress = useCallback(async () => {
    if (!slug) return;
    try {
      await AsyncStorage.removeItem(progressKey(slug));
    } catch {
      // Non-critical
    }
  }, [slug]);

  const handleSelectOption = (idx: number) => {
    if (phase !== "question") return;
    setSelectedIndex(idx);
  };

  const handleSubmit = useCallback(() => {
    if (selectedIndex === null || !currentQ) return;

    const newAnswers = [...answers];
    newAnswers[currentIndex] = selectedIndex;
    setAnswers(newAnswers);
    setPhase("feedback");

    // Persist progress after each answer
    persistProgress(currentIndex, newAnswers);
  }, [selectedIndex, currentQ, answers, currentIndex, persistProgress]);

  const handleNext = useCallback(async () => {
    const isLast = currentIndex === questions.length - 1;

    if (isLast) {
      // Compute score
      const score = answers.filter((a, i) => a === questions[i]?.correctIndex).length;
      const total = questions.length;

      // Clear saved progress — quiz is complete
      await clearProgress();

      // Submit to progress API (not for practice)
      if (!isPractice && deviceId && slug && !submitted) {
        setSubmitting(true);
        try {
          await markComplete(slug, score);
        } catch { /* ignore */ }
      }
      setPhase("results");
    } else {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setSelectedIndex(null);
      setPhase("question");
      // Persist the advanced index so a close on the new blank question
      // doesn't reopen one question behind.
      persistProgress(nextIndex, answers);
    }
  }, [currentIndex, questions, answers, isPractice, deviceId, slug, submitted, markComplete, clearProgress, persistProgress]);

  const handleRetake = () => {
    setCurrentIndex(0);
    setSelectedIndex(null);
    setPhase("question");
    setAnswers([]);
    setSubmitting(false);
    clearProgress();
  };

  // Resume from saved progress — land at first unanswered question so the
  // driver never re-answers a question they already submitted, even if the
  // app closed between Submit and Next.
  const handleResume = () => {
    if (!savedProgress) return;
    const resumeIndex = savedProgress.answers.findIndex((a) => a === null);
    setCurrentIndex(resumeIndex >= 0 ? resumeIndex : 0);
    setAnswers(savedProgress.answers);
    setSelectedIndex(null);
    setPhase("question");
    setShowResumePrompt(false);
    setSavedProgress(null);
  };

  // Start fresh — discard saved progress
  const handleStartFresh = async () => {
    await clearProgress();
    setSavedProgress(null);
    setShowResumePrompt(false);
    // State already initialised to defaults (index=0, answers=[], etc.)
  };

  const topInset = Platform.OS === "ios" ? insets.top : insets.top;
  const bottomInset = Platform.OS === "web" ? 24 : insets.bottom;

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error || !lesson || questions.length === 0) {
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
            {error ?? "No quiz questions found for this lesson."}
          </Text>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: colors.primary, marginTop: 8, paddingHorizontal: 24 }]}
            onPress={() => router.back()}
          >
            <Text style={styles.ctaBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Resume prompt ────────────────────────────────────────────────────────────
  if (showResumePrompt && savedProgress) {
    return (
      <ResumePrompt
        currentIndex={savedProgress.currentIndex}
        total={questions.length}
        colors={colors}
        insets={{ top: insets.top, bottom: insets.bottom }}
        onResume={handleResume}
        onStartFresh={handleStartFresh}
      />
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  if (phase === "results") {
    const score = answers.filter((a, i) => a === questions[i]?.correctIndex).length;
    return (
      <ResultsScreen
        score={score}
        total={questions.length}
        lessonTitle={lesson.title}
        lessonSlug={slug ?? ""}
        isPractice={isPractice}
        onRetake={handleRetake}
        colors={colors}
        insets={{ top: insets.top, bottom: insets.bottom }}
      />
    );
  }

  // ── Question / Feedback ─────────────────────────────────────────────────────
  const showResult = phase === "feedback";
  const isCorrect = selectedIndex === currentQ.correctIndex;
  const isLast = currentIndex === questions.length - 1;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: topInset + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>
          {isPractice ? "Practice Quiz" : "Lesson Quiz"}
        </Text>
        <Text style={[styles.progressCount, { color: colors.mutedForeground }]}>
          {currentIndex + 1}/{questions.length}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressBarTrack, { backgroundColor: colors.muted }]}>
        <View
          style={[
            styles.progressBarFill,
            {
              backgroundColor: colors.primary,
              width: `${((currentIndex + (phase === "feedback" ? 1 : 0)) / questions.length) * 100}%` as any,
            },
          ]}
        />
      </View>

      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Question */}
        <Text style={[styles.questionNum, { color: colors.mutedForeground }]}>
          Question {currentIndex + 1} of {questions.length}
        </Text>
        <Text style={[styles.questionText, { color: colors.foreground }]}>
          {currentQ.question}
        </Text>

        {/* Options */}
        <View style={styles.optionsGap}>
          {currentQ.options.map((opt, i) => (
            <OptionCard
              key={i}
              text={opt}
              index={i}
              selected={selectedIndex === i}
              correct={i === currentQ.correctIndex}
              showResult={showResult}
              onPress={() => handleSelectOption(i)}
              colors={colors}
            />
          ))}
        </View>

        {/* Feedback banner */}
        {showResult && (
          <View
            style={[
              styles.feedbackBanner,
              {
                backgroundColor: isCorrect ? "#00C85318" : "#FF3B3018",
                borderColor: isCorrect ? "#00C85340" : "#FF3B3040",
              },
            ]}
          >
            <Feather
              name={isCorrect ? "check-circle" : "x-circle"}
              size={20}
              color={isCorrect ? "#00C853" : "#FF3B30"}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.feedbackTitle, { color: isCorrect ? "#00C853" : "#FF3B30" }]}>
                {isCorrect ? "Correct!" : "Not quite"}
              </Text>
              {!isCorrect && (
                <Text style={[styles.feedbackBody, { color: colors.mutedForeground }]}>
                  The correct answer is: {currentQ.options[currentQ.correctIndex]}
                </Text>
              )}
              <Text style={[styles.feedbackRef, { color: colors.mutedForeground }]}>
                See: {lesson.title}
              </Text>
            </View>
          </View>
        )}

        {/* Submit / Next button */}
        {phase === "question" ? (
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              {
                backgroundColor: selectedIndex !== null ? colors.primary : colors.muted,
              },
            ]}
            onPress={handleSubmit}
            disabled={selectedIndex === null}
            activeOpacity={0.85}
          >
            <Text style={[styles.ctaBtnText, { color: selectedIndex !== null ? "#fff" : colors.mutedForeground }]}>
              Submit answer
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: colors.primary }]}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaBtnText}>
              {isLast ? "See results" : "Next question"}
            </Text>
            <Feather name={isLast ? "award" : "arrow-right"} size={16} color="#fff" />
          </TouchableOpacity>
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
  topBarTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    paddingHorizontal: 4,
  },
  progressCount: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    minWidth: 38,
    textAlign: "right",
  },
  progressBarTrack: {
    height: 3,
    width: "100%",
  },
  progressBarFill: {
    height: 3,
    borderRadius: 2,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  questionNum: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  questionText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    lineHeight: 26,
  },
  optionsGap: { gap: 10 },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
  },
  optionLabel: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  optionLabelText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  optionText: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  feedbackBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  feedbackTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  feedbackBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginBottom: 4,
  },
  feedbackRef: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
  },
  ctaBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  // Resume prompt card
  resumeCard: {
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  resumeIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  resumeTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  resumeBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 4,
  },
  // Results
  resultsContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    alignItems: "center",
    gap: 16,
  },
  scoreCircleWrap: { alignItems: "center", marginBottom: 8 },
  scoreCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  scoreLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  passBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  passBadgeText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  lessonTitleSmall: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  scoreBarTrack: {
    width: "100%",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: 8,
    borderRadius: 4,
  },
  scoreBarLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
