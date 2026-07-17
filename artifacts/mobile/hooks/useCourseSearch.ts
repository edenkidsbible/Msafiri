import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/utils/apiClient";

export interface SearchResult {
  slug: string;
  title: string;
  estimatedMinutes: number;
  excerpt: string;
}

interface SearchResponse {
  results: SearchResult[];
}

/**
 * Debounced course search hook.
 * - Online: calls GET /api/course/search?q=
 * - Offline fallback: filters the provided titleIndex by substring match
 */
export function useCourseSearch(titleIndex: Array<{ slug: string; title: string }>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }

      // Cancel any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setSearching(true);
      try {
        const data = await apiGet<SearchResponse>(
          `/course/search?q=${encodeURIComponent(q.trim())}`
        );
        setResults(data.results ?? []);
      } catch {
        // Offline fallback: substring match on title index
        const lower = q.toLowerCase();
        const fallback = titleIndex
          .filter((l) => l.title.toLowerCase().includes(lower))
          .slice(0, 20)
          .map((l) => ({ slug: l.slug, title: l.title, estimatedMinutes: 0, excerpt: "" }));
        setResults(fallback);
      } finally {
        setSearching(false);
      }
    },
    [titleIndex]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(() => {
      runSearch(query);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  return { query, setQuery, results, searching };
}
