import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Eye, Clock, ArrowLeft, ChevronRight } from "lucide-react";
import logo from "@/assets/logo.png";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface BlogPostFull {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  author: string;
  status: string;
  featuredImage: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string[] | null;
  readCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RelatedPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
  readCount: number;
}

function usePost(slug: string) {
  return useQuery<BlogPostFull>({
    queryKey: ["/api/blog/posts", slug],
    queryFn: () => fetch(`${API_BASE}/blog/posts/${slug}`).then((r) => {
      if (!r.ok) throw new Error("not found");
      return r.json();
    }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

function useRelatedPosts() {
  return useQuery<{ posts: RelatedPost[] }>({
    queryKey: ["/api/blog/posts/related"],
    queryFn: () => fetch(`${API_BASE}/blog/posts?limit=4`).then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function estimateReadTime(content: string) {
  const words = content.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function setMetaTag(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
  el.setAttribute("content", content);
}

function setOgTag(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!el) { el = document.createElement("meta"); el.setAttribute("property", property); document.head.appendChild(el); }
  el.setAttribute("content", content);
}

function injectJsonLd(post: BlogPostFull) {
  const existing = document.getElementById("blog-ld-json");
  if (existing) existing.remove();
  const script = document.createElement("script");
  script.id = "blog-ld-json";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.metaDescription || post.excerpt || "",
    author: { "@type": "Organization", name: post.author },
    publisher: { "@type": "Organization", name: "Msafiri Kenya", logo: { "@type": "ImageObject", url: "https://msafiri.co.ke/logo.png" } },
    datePublished: post.publishedAt || post.createdAt,
    dateModified: post.updatedAt,
    image: post.featuredImage || "https://msafiri.co.ke/og-default.png",
    keywords: (post.keywords || []).join(", "),
  });
  document.head.appendChild(script);
}

export default function BlogPost() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";
  const { data: post, isLoading, isError } = usePost(slug);
  const { data: relatedData } = useRelatedPosts();

  useEffect(() => {
    if (!post) return;
    const title = post.metaTitle || `${post.title} | Msafiri Kenya`;
    document.title = title;
    setMetaTag("description", post.metaDescription || post.excerpt || "Road safety guide for Kenyan drivers by Msafiri Kenya.");
    setMetaTag("keywords", (post.keywords || []).join(", "));
    setOgTag("og:title", title);
    setOgTag("og:description", post.metaDescription || post.excerpt || "");
    setOgTag("og:type", "article");
    setOgTag("og:image", post.featuredImage || "");
    setMetaTag("twitter:card", "summary_large_image");
    setMetaTag("twitter:title", title);
    setMetaTag("twitter:description", post.metaDescription || post.excerpt || "");
    injectJsonLd(post);
    return () => {
      document.title = "Msafiri Kenya — Drive Smart, Stay Safe";
      document.getElementById("blog-ld-json")?.remove();
    };
  }, [post]);

  const relatedPosts = (relatedData?.posts ?? []).filter((p) => p.slug !== slug).slice(0, 3);
  const readTime = post ? estimateReadTime(post.content) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Nav */}
      <nav className="border-b border-border/30 py-4 px-6 sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src={logo} alt="Msafiri" className="w-7 h-7" />
            <span className="font-bold text-lg tracking-tight">Msafiri</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/blog" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" /> Blog
            </Link>
            <a
              href="https://apps.apple.com/ke/app/msafiri-kenya/id6744402038"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors hidden sm:inline-block"
            >
              Get the App
            </a>
          </div>
        </div>
      </nav>

      {isLoading && (
        <div className="max-w-3xl mx-auto px-6 py-16 animate-pulse space-y-6">
          <div className="h-8 bg-muted rounded w-3/4" />
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-48 bg-muted rounded" />
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-4 bg-muted rounded" />)}
          </div>
        </div>
      )}

      {isError && (
        <div className="max-w-3xl mx-auto px-6 py-32 text-center">
          <p className="text-2xl font-bold mb-2">Article not found</p>
          <p className="text-muted-foreground mb-6">This article may have been moved or doesn't exist.</p>
          <Link href="/blog" className="inline-flex items-center gap-2 text-primary font-semibold">
            <ArrowLeft className="w-4 h-4" /> Back to Blog
          </Link>
        </div>
      )}

      {post && (
        <>
          {/* Article header */}
          <div className="border-b border-border/20 py-12 px-6" style={{ background: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)" }}>
            <div className="max-w-3xl mx-auto">
              <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
                <ArrowLeft className="w-4 h-4" /> All articles
              </Link>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight mb-4">{post.title}</h1>
              {post.excerpt && <p className="text-muted-foreground text-base leading-relaxed mb-5">{post.excerpt}</p>}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{post.author}</span>
                <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{formatDate(post.publishedAt)}</span>
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{readTime} min read</span>
                <span className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />{post.readCount.toLocaleString()} reads</span>
              </div>
            </div>
          </div>

          {/* Featured image */}
          {post.featuredImage && (
            <div className="max-w-3xl mx-auto px-6 mt-8">
              <img
                src={post.featuredImage}
                alt={post.title}
                className="w-full rounded-2xl object-cover max-h-72"
              />
            </div>
          )}

          {/* Article body */}
          <div className="max-w-3xl mx-auto px-6 py-10">
            <div
              className="prose prose-sm sm:prose max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-primary prose-strong:text-foreground"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {/* Keywords */}
            {post.keywords && post.keywords.length > 0 && (
              <div className="mt-10 pt-6 border-t border-border/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Topics</p>
                <div className="flex flex-wrap gap-2">
                  {post.keywords.map((kw) => (
                    <span key={kw} className="text-xs bg-muted px-3 py-1 rounded-full text-muted-foreground">{kw}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* App CTA in article */}
          <div className="max-w-3xl mx-auto px-6 mb-12">
            <div className="rounded-2xl bg-primary/5 border border-primary/20 p-6 md:p-8">
              <div className="flex items-start gap-4">
                <div className="bg-primary/10 rounded-xl p-3 shrink-0">
                  <img src={logo} alt="" className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg mb-1">Drive smarter with Msafiri</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                    Get real-time alerts for speed cameras, police checkpoints, alcoblow roadblocks, and road hazards across Kenya — all free to download.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <a href="https://apps.apple.com/ke/app/msafiri-kenya/id6744402038" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 bg-foreground text-background px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
                      Download on App Store
                    </a>
                    <a href="https://play.google.com/store/apps/details?id=com.msafiri.app" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 border border-border bg-background px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-muted transition-colors">
                      Get it on Google Play
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Related articles */}
          {relatedPosts.length > 0 && (
            <div className="border-t border-border/20 py-12 px-6">
              <div className="max-w-3xl mx-auto">
                <h2 className="font-bold text-lg mb-6">More articles</h2>
                <div className="space-y-4">
                  {relatedPosts.map((rp) => (
                    <Link key={rp.id} href={`/blog/${rp.slug}`} className="block group">
                      <div className="flex items-center justify-between p-4 rounded-xl border border-border/40 hover:border-primary/40 hover:shadow-sm transition-all">
                        <div className="flex-1 min-w-0 mr-4">
                          <p className="font-semibold text-sm leading-snug group-hover:text-primary transition-colors">{rp.title}</p>
                          {rp.excerpt && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rp.excerpt}</p>}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                      </div>
                    </Link>
                  ))}
                </div>
                <Link href="/blog" className="mt-6 inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:underline">
                  View all articles <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <footer className="border-t border-border/30 py-8 px-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <img src={logo} alt="Msafiri" className="w-6 h-6" />
          <span className="font-bold text-base">Msafiri</span>
        </div>
        <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground mb-3">
          <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
          <Link href="/blog" className="hover:text-foreground transition-colors">Blog</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Msafiri Kenya. All rights reserved.</p>
      </footer>
    </div>
  );
}
