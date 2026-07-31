import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet } from "@/utils/apiClient";

const CACHE_KEY = "course_chapters_cache_v2";

export interface CourseLesson {
  id: string;
  slug: string;
  chapterId: string;
  title: string;
  order: number;
  estimatedMinutes: number;
  createdAt: string;
}

export interface CourseChapter {
  id: string;
  slug: string;
  title: string;
  unitNumber: number;
  order: number;
  createdAt: string;
  lessons: CourseLesson[];
}

interface ChaptersResponse {
  chapters: CourseChapter[];
}

export function useCourseData() {
  const [chapters, setChapters] = useState<CourseChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // 1. Try cache first so UI loads instantly
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setChapters(parsed as CourseChapter[]);
          setLoading(false);
        } else {
          // Corrupt/unexpected shape — discard so it never crashes a render
          void AsyncStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {
      // Corrupt cache entry — discard and fall through to the fresh fetch
      void AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
    }

    // 2. Fetch fresh from API
    try {
      const data = await apiGet<ChaptersResponse>("/course/chapters");
      setChapters(data.chapters);
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data.chapters));
      } catch {
        // ignore cache write errors
      }
    } catch (err: any) {
      // Only set error if we have no cached data to show
      setError(err?.message ?? "Failed to load course");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { chapters, loading, error, reload: load };
}
