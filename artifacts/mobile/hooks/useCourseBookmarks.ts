import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/utils/apiClient";

export interface BookmarkRecord {
  lessonSlug: string;
  createdAt: string;
}

interface BookmarksResponse {
  bookmarks: BookmarkRecord[];
}

/**
 * Manages course bookmarks for a given deviceId.
 * Bookmarks are fetched on mount and kept in state.
 * Toggle is optimistic — reverts on API failure.
 */
export function useCourseBookmarks(deviceId: string | null) {
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBookmarks = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const data = await apiGet<BookmarksResponse>(
        `/course/bookmarks?deviceId=${encodeURIComponent(deviceId)}`
      );
      setBookmarks(data.bookmarks ?? []);
    } catch {
      // silently ignore — offline
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const isBookmarked = useCallback(
    (slug: string) => bookmarks.some((b) => b.lessonSlug === slug),
    [bookmarks]
  );

  const toggleBookmark = useCallback(
    async (slug: string) => {
      if (!deviceId) return;
      const wasBookmarked = bookmarks.some((b) => b.lessonSlug === slug);

      // Optimistic update
      if (wasBookmarked) {
        setBookmarks((prev) => prev.filter((b) => b.lessonSlug !== slug));
      } else {
        setBookmarks((prev) => [
          ...prev,
          { lessonSlug: slug, createdAt: new Date().toISOString() },
        ]);
      }

      try {
        if (wasBookmarked) {
          await apiDelete("/course/bookmarks", { deviceId, lessonSlug: slug });
        } else {
          await apiPost("/course/bookmarks", { deviceId, lessonSlug: slug });
        }
      } catch {
        // Revert on failure
        if (wasBookmarked) {
          setBookmarks((prev) => [
            ...prev,
            { lessonSlug: slug, createdAt: new Date().toISOString() },
          ]);
        } else {
          setBookmarks((prev) => prev.filter((b) => b.lessonSlug !== slug));
        }
      }
    },
    [deviceId, bookmarks]
  );

  return { bookmarks, loading, isBookmarked, toggleBookmark, refetch: fetchBookmarks };
}
