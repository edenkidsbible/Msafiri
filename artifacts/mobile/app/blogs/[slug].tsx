import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
  content: string;
  author: string;
  featuredImage: string | null;
  publishedAt: string | null;
  createdAt: string;
  keywords: string[] | null;
}

// ── Simple HTML → native blocks ──────────────────────────────────────
type Block =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "li"; text: string }
  | { kind: "img"; src: string; alt: string }
  | { kind: "divider" };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function resolveImgSrc(src: string): string {
  if (!src) return "";
  if (src.startsWith("http")) return src;
  return SITE_BASE + src;
}

function parseHtml(html: string): Block[] {
  const blocks: Block[] = [];

  // Split the HTML into segments by opening block-level tags so we can
  // process each chunk independently.
  const segments = html.split(/(?=<(?:h[1-6]|p|ul|ol|li|img|hr)\b)/i);

  for (const seg of segments) {
    const t = seg.trim();
    if (!t) continue;

    // h2
    const h2 = t.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2) { const text = stripTags(h2[1]); if (text) blocks.push({ kind: "h2", text }); continue; }

    // h3
    const h3 = t.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3) { const text = stripTags(h3[1]); if (text) blocks.push({ kind: "h3", text }); continue; }

    // h4/h5/h6 — treat as h3
    const hx = t.match(/^<h[456][^>]*>([\s\S]*?)<\/h[456]>/i);
    if (hx) { const text = stripTags(hx[1]); if (text) blocks.push({ kind: "h3", text }); continue; }

    // paragraph
    const p = t.match(/^<p[^>]*>([\s\S]*?)<\/p>/i);
    if (p) { const text = stripTags(p[1]); if (text) blocks.push({ kind: "p", text }); continue; }

    // list item
    const li = t.match(/^<li[^>]*>([\s\S]*?)<\/li>/i);
    if (li) { const text = stripTags(li[1]); if (text) blocks.push({ kind: "li", text }); continue; }

    // image
    const img = t.match(/^<img\s[^>]*>/i);
    if (img) {
      const srcM = img[0].match(/src=["']([^"']+)["']/i);
      const altM = img[0].match(/alt=["']([^"']*)["']/i);
      if (srcM) blocks.push({ kind: "img", src: resolveImgSrc(srcM[1]), alt: altM?.[1] ?? "" });
      continue;
    }

    // hr
    if (/^<hr/i.test(t)) { blocks.push({ kind: "divider" }); continue; }

    // anything else with visible text (e.g. stray inline content)
    const text = stripTags(t);
    if (text.length > 2) blocks.push({ kind: "p", text });
  }

  return blocks;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────
export default function BlogPostScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    apiGet<BlogPost>(`/blog/posts/${slug}`)
      .then(setPost)
      .catch((e) => setError(e.message ?? "Failed to load article"))
      .finally(() => setLoading(false));
  }, [slug]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  // ── Back button bar ────────────────────────────────────────────────
  const BackBar = (
    <View
      style={[
        s.backBar,
        { paddingTop: topInset, borderBottomColor: c.border, backgroundColor: c.background },
      ]}
    >
      <TouchableOpacity onPress={() => router.back()} hitSlop={16} style={s.backBtn}>
        <Ionicons name="arrow-back" size={22} color={c.foreground} />
        <Text style={[s.backLabel, { color: c.foreground }]}>Blog</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[s.screen, { backgroundColor: c.background }]}>
        {BackBar}
        <View style={s.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </View>
    );
  }

  if (error || !post) {
    return (
      <View style={[s.screen, { backgroundColor: c.background }]}>
        {BackBar}
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={48} color={c.mutedForeground} />
          <Text style={[s.errorText, { color: c.mutedForeground }]}>
            {error ?? "Article not found"}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={[s.retryBtn, { backgroundColor: c.primary }]}>
            <Text style={[s.retryBtnText, { color: c.primaryForeground }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const blocks = parseHtml(post.content);
  const heroImage = post.featuredImage
    ? resolveImgSrc(post.featuredImage)
    : null;

  return (
    <View style={[s.screen, { backgroundColor: c.background }]}>
      {BackBar}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Hero image */}
        {heroImage ? (
          <Image source={{ uri: heroImage }} style={s.heroImage} resizeMode="cover" />
        ) : null}

        {/* Title block */}
        <View style={s.titleBlock}>
          <Text style={[s.title, { color: c.foreground }]}>{post.title}</Text>
          <View style={s.meta}>
            <View style={[s.authorBadge, { backgroundColor: c.primary + "18" }]}>
              <Ionicons name="person" size={11} color={c.primary} />
              <Text style={[s.metaText, { color: c.primary }]}>{post.author}</Text>
            </View>
            <Text style={[s.metaText, { color: c.mutedForeground }]}>
              {formatDate(post.publishedAt ?? post.createdAt)}
            </Text>
          </View>
          {post.excerpt ? (
            <Text style={[s.excerpt, { color: c.mutedForeground }]}>{post.excerpt}</Text>
          ) : null}
        </View>

        {/* Divider */}
        <View style={[s.rule, { backgroundColor: c.border }]} />

        {/* Article body */}
        <View style={s.body}>
          {blocks.map((block, i) => {
            switch (block.kind) {
              case "h2":
                return (
                  <Text key={i} style={[s.h2, { color: c.foreground }]}>
                    {block.text}
                  </Text>
                );
              case "h3":
                return (
                  <Text key={i} style={[s.h3, { color: c.foreground }]}>
                    {block.text}
                  </Text>
                );
              case "p":
                return (
                  <Text key={i} style={[s.paragraph, { color: c.foreground }]}>
                    {block.text}
                  </Text>
                );
              case "li":
                return (
                  <View key={i} style={s.liRow}>
                    <View style={[s.bullet, { backgroundColor: c.primary }]} />
                    <Text style={[s.liText, { color: c.foreground }]}>{block.text}</Text>
                  </View>
                );
              case "img":
                return block.src ? (
                  <Image
                    key={i}
                    source={{ uri: block.src }}
                    style={s.inlineImage}
                    resizeMode="cover"
                    accessibilityLabel={block.alt}
                  />
                ) : null;
              case "divider":
                return <View key={i} style={[s.rule, { backgroundColor: c.border }]} />;
              default:
                return null;
            }
          })}
        </View>

        {/* Keywords */}
        {post.keywords && post.keywords.length > 0 && (
          <View style={[s.keywordsSection, { borderTopColor: c.border }]}>
            <Text style={[s.keywordsLabel, { color: c.mutedForeground }]}>TOPICS</Text>
            <View style={s.keywordsRow}>
              {post.keywords.map((kw) => (
                <View key={kw} style={[s.keyword, { backgroundColor: c.muted }]}>
                  <Text style={[s.keywordText, { color: c.mutedForeground }]}>{kw}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  backBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backLabel: { fontSize: 16, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  heroImage: { width: "100%", height: 220 },

  titleBlock: { padding: 20, gap: 10 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", lineHeight: 30 },
  meta: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  authorBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  excerpt: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, fontStyle: "italic" },

  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20, marginVertical: 4 },

  body: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  h2: { fontSize: 19, fontFamily: "Inter_700Bold", lineHeight: 26, marginTop: 10 },
  h3: { fontSize: 16, fontFamily: "Inter_600SemiBold", lineHeight: 22, marginTop: 6 },
  paragraph: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24 },
  liRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingLeft: 4 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 9, flexShrink: 0 },
  liText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 24, flex: 1 },
  inlineImage: {
    width: "100%", height: 200, borderRadius: 12, marginVertical: 4,
  },

  keywordsSection: { marginTop: 20, marginHorizontal: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  keywordsLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5 },
  keywordsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  keyword: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  keywordText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
