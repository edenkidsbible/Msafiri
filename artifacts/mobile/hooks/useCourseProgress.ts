import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/utils/apiClient";

export interface ProgressRecord {
  lessonSlug: string;
  quizScore: number | null;
  completedAt: string;
}

interface ProgressResponse {
  progress: ProgressRecord[];
}

export function useCourseProgress(deviceId: string | null) {
  const [progress, setProgress] = useState<ProgressRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProgress = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const data = await apiGet<ProgressResponse>(
        `/course/progress?deviceId=${encodeURIComponent(deviceId)}`
      );
      setProgress(data.progress ?? []);
    } catch {
      // silently ignore — offline or server unreachable
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  const isCompleted = useCallback(
    (lessonSlug: string) => progress.some((p) => p.lessonSlug === lessonSlug),
    [progress]
  );

  const markComplete = useCallback(
    async (lessonSlug: string, quizScore?: number) => {
      if (!deviceId) return;
      // Optimistic update
      setProgress((prev) => {
        if (prev.some((p) => p.lessonSlug === lessonSlug)) return prev;
        return [
          ...prev,
          {
            lessonSlug,
            quizScore: quizScore ?? null,
            completedAt: new Date().toISOString(),
          },
        ];
      });
      try {
        await apiPost("/course/progress", { deviceId, lessonSlug, quizScore });
      } catch {
        // Revert optimistic update on failure
        setProgress((prev) => prev.filter((p) => p.lessonSlug !== lessonSlug));
      }
    },
    [deviceId]
  );

  return { progress, loading, isCompleted, markComplete, refetch: fetchProgress };
}
