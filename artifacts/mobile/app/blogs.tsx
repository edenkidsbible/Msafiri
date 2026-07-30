import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/apiClient";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
const SITE_BASE = DOMAIN ? `https://${DOMAIN}` : "";

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  author: string;
  featuredImage: string | null;
  publishedAt: string | null;
  createdAt: string;
  readCount: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function resolveImage(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return SITE_BASE + path;
}

export default function BlogsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiGet<{ posts: BlogPost[] }>("/blog/posts?limit=20");
      setPosts(data.posts ?? []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load articles");
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[s.screen, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topInset, borderBottomColor: c.border, backgroundColor: c.background }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={16} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={c.foreground} />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={[s.headerTitle, { color: c.foreground }]}>Msafiri Blog</Text>
          <Text style={[s.headerSub, { color: c.mutedForeground }]}>Road safety tips & driving guides</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={c.mutedForeground} />
          <Text style={[s.errorText, { color: c.mutedForeground }]}>{error}</Text>
          <TouchableOpacity onPress={load} style={[s.retryBtn, { backgroundColor: c.primary }]}>
            <Text style={[s.retryBtnText, { color: c.primaryForeground }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="newspaper-outline" size={48} color={c.mutedForeground} />
              <Text style={[s.errorText, { color: c.mutedForeground }]}>No articles yet</Text>
            </View>
          }
          renderItem={({ item }) => {
            const imageUri = resolveImage(item.featuredImage);
            return (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => router.push(`/blogs/${item.slug}` as any)}
                style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}
              >
                {imageUri && (
                  <Image
                    source={{ uri: imageUri }}
                    style={s.cardImage}
                    resizeMode="cover"
                  />
                )}
                <View style={s.cardBody}>
                  <Text style={[s.cardTitle, { color: c.foreground }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.excerpt ? (
                    <Text style={[s.cardExcerpt, { color: c.mutedForeground }]} numberOfLines={3}>
                      {item.excerpt}
                    </Text>
                  ) : null}
                  <View style={s.cardMeta}>
                    <View style={[s.authorBadge, { backgroundColor: c.primary + "18" }]}>
                      <Ionicons name="person" size={10} color={c.primary} />
                      <Text style={[s.metaText, { color: c.primary }]}>{item.author}</Text>
                    </View>
                    <Text style={[s.metaText, { color: c.mutedForeground }]}>
                      {formatDate(item.publishedAt ?? item.createdAt)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardImage: { width: "100%", height: 180 },
  cardBody: { padding: 14, gap: 8 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", lineHeight: 22 },
  cardExcerpt: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  cardMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  authorBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  metaText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
