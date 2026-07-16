import { useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Eye, ChevronRight, Rss } from "lucide-react";
import logo from "@/assets/logo.png";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface BlogPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  author: string;
  featuredImage: string | null;
  keywords: string[] | null;
  readCount: number;
  publishedAt: string | null;
  createdAt: string;
}

function useBlogPosts(page = 1) {
  return useQuery<{ posts: BlogPostSummary[]; total: number; pages: number }>({
    queryKey: ["/api/blog/posts", page],
    queryFn: () => fetch(`${API_BASE}/blog/posts?page=${page}&limit=9`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export default function BlogList() {
  const { data, isLoading } = useBlogPosts(1);

  useEffect(() => {
    document.title = "Msafiri Kenya Blog — Road Safety Tips, NTSA Fines, Speed Camera Locations";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "Expert articles on Kenyan road safety: NTSA speed cameras, traffic fines, police checkpoints, alcoblow locations, and smart driving tips for Nairobi and Kenya highways.");
  }, []);

  const posts = data?.posts ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Nav */}
      <nav className="border-b border-border/30 py-4 px-6 sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src={logo} alt="Msafiri" className="w-7 h-7" />
            <span className="font-bold text-lg tracking-tight">Msafiri</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/#features" className="text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Features</Link>
            <Link href="/blog" className="text-foreground font-medium">Blog</Link>
            <a
              href="https://apps.apple.com/us/app/msafiri-kenya/id6789483834"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Get the App
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="py-16 px-6 text-center border-b border-border/20" style={{ background: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)" }}>
        <div className="flex items-center justify-center gap-2 mb-4">
          <Rss className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-primary">Msafiri Kenya Blog</p>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          Smarter Driving.<br className="sm:hidden" /> Safer Roads.
        </h1>
        <p className="text-muted-foreground text-base max-w-xl mx-auto leading-relaxed">
          Expert guides on NTSA speed cameras, traffic fines, police checkpoints, alcoblow locations, and road safety for Kenyan drivers.
        </p>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border/40 overflow-hidden animate-pulse">
                <div className="h-40 bg-muted" />
                <div className="p-5 space-y-3">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <p className="text-lg font-medium">No articles yet — check back soon!</p>
          </div>
        ) : (
          <>
            {/* Featured first post */}
            {posts[0] && (
              <Link href={`/blog/${posts[0].slug}`} className="block group mb-10">
                <div className="rounded-2xl border border-border/40 overflow-hidden hover:border-primary/40 hover:shadow-lg transition-all duration-200 md:flex">
                  {posts[0].featuredImage ? (
                    <div className="md:w-2/5 h-52 md:h-auto overflow-hidden">
                      <img src={posts[0].featuredImage} alt={posts[0].title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                  ) : (
                    <div className="md:w-2/5 h-52 md:h-auto bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                      <img src={logo} alt="" className="w-16 h-16 opacity-30" />
                    </div>
                  )}
                  <div className="md:w-3/5 p-6 md:p-8 flex flex-col justify-center">
                    <span className="inline-block text-xs font-semibold text-primary uppercase tracking-widest mb-3">Featured</span>
                    <h2 className="text-xl md:text-2xl font-bold leading-snug group-hover:text-primary transition-colors mb-3">{posts[0].title}</h2>
                    {posts[0].excerpt && <p className="text-muted-foreground text-sm leading-relaxed mb-4 line-clamp-3">{posts[0].excerpt}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(posts[0].publishedAt)}</span>
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{posts[0].readCount.toLocaleString()} reads</span>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm text-primary font-semibold group-hover:gap-2 transition-all">
                      Read article <ChevronRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </Link>
            )}

            {/* Grid of remaining posts */}
            {posts.length > 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {posts.slice(1).map((post) => (
                  <Link key={post.id} href={`/blog/${post.slug}`} className="block group">
                    <div className="rounded-2xl border border-border/40 overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200 h-full flex flex-col">
                      {post.featuredImage ? (
                        <div className="h-40 overflow-hidden">
                          <img src={post.featuredImage} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </div>
                      ) : (
                        <div className="h-40 bg-gradient-to-br from-primary/8 to-primary/3 flex items-center justify-center">
                          <img src={logo} alt="" className="w-10 h-10 opacity-25" />
                        </div>
                      )}
                      <div className="p-5 flex flex-col flex-1">
                        <h3 className="font-bold text-base leading-snug group-hover:text-primary transition-colors mb-2">{post.title}</h3>
                        {post.excerpt && <p className="text-muted-foreground text-sm leading-relaxed line-clamp-2 flex-1">{post.excerpt}</p>}
                        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(post.publishedAt)}</span>
                          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{post.readCount.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* App CTA */}
      <div className="border-t border-border/30 bg-primary/5 py-16 px-6 text-center">
        <h2 className="text-2xl font-bold mb-3">Get real-time alerts while you drive</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
          Msafiri warns you about speed cameras, police checkpoints, alcoblow, and road hazards in real time — so you drive safer, not just smarter.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="https://apps.apple.com/us/app/msafiri-kenya/id6789483834" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-3 bg-foreground text-background px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">
            Download on App Store
          </a>
          <a href="https://play.google.com/store/apps/details?id=com.msafirikenya.app" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-3 border border-border bg-background px-6 py-3 rounded-xl font-semibold text-sm hover:bg-muted transition-colors">
            Get it on Google Play
          </a>
        </div>
      </div>

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
