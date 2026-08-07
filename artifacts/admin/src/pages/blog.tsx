import { useRef, useState } from "react";
import { uploadToR2 } from "@/lib/storage";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText, Plus, MoreVertical, Eye, BookOpen,
  Edit2, Trash2, TrendingUp, Globe, FileEdit, Download, Upload, Loader2,
} from "lucide-react";

const API_BASE = "/api";

async function authFetch(path: string, init?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `API ${res.status}` }));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

function slugify(str: string) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface BlogPost {
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

interface BlogStats {
  totalReads: number;
  publishedCount: number;
  draftCount: number;
  topPosts: { id: string; slug: string; title: string; status: string; readCount: number; publishedAt: string | null }[];
}

const emptyForm = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  author: "Msafiri Team",
  status: "draft",
  featuredImage: "",
  metaTitle: "",
  metaDescription: "",
  keywords: "",
};

export default function Blog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPost, setEditPost] = useState<BlogPost | null>(null);
  const [deletePost, setDeletePost] = useState<BlogPost | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(file: File) {
    setImageUploading(true);
    setImageUploadProgress(0);
    try {
      const { objectPath, publicUrl } = await uploadToR2(file, {
        visibility: "public",
        onProgress: setImageUploadProgress,
      });
      // Use the unauthenticated public URL so marketing visitors can load the image.
      const imageUrl = publicUrl ?? `/api/storage/objects${objectPath.replace(/^\/objects/, "")}`;
      setForm((f) => ({ ...f, featuredImage: imageUrl }));
      toast({ title: "Image uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setImageUploading(false);
      setImageUploadProgress(0);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  const { data: statsData } = useQuery<BlogStats>({
    queryKey: ["/api/admin/blog/stats"],
    queryFn: () => authFetch("/admin/blog/stats"),
  });

  const { data, isLoading } = useQuery<{ posts: BlogPost[]; total: number }>({
    queryKey: ["/api/admin/blog/posts", statusFilter],
    queryFn: () => authFetch(`/admin/blog/posts?limit=50${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => authFetch("/admin/blog/posts", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/stats"] });
      setDialogOpen(false);
      toast({ title: "Post created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      authFetch(`/admin/blog/posts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/stats"] });
      setDialogOpen(false);
      toast({ title: "Post updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authFetch(`/admin/blog/posts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/stats"] });
      setDeletePost(null);
      toast({ title: "Post deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedMutation = useMutation({
    mutationFn: () => authFetch("/admin/blog/seed", { method: "POST" }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/blog/stats"] });
      toast({
        title: `Seeded ${result.inserted} post${result.inserted !== 1 ? "s" : ""}`,
        description: result.skipped > 0 ? `${result.skipped} already existed and were skipped.` : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditPost(null);
    setForm(emptyForm);
    setSlugManuallyEdited(false);
    setDialogOpen(true);
  }

  function openEdit(post: BlogPost) {
    setEditPost(post);
    setForm({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || "",
      content: post.content,
      author: post.author,
      status: post.status,
      featuredImage: post.featuredImage || "",
      metaTitle: post.metaTitle || "",
      metaDescription: post.metaDescription || "",
      keywords: (post.keywords || []).join(", "),
    });
    setSlugManuallyEdited(true);
    setDialogOpen(true);
  }

  function handleTitleChange(val: string) {
    setForm((f) => ({
      ...f,
      title: val,
      slug: slugManuallyEdited ? f.slug : slugify(val),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      title: form.title,
      slug: form.slug || slugify(form.title),
      excerpt: form.excerpt || null,
      content: form.content,
      author: form.author || "Msafiri Team",
      status: form.status,
      featuredImage: form.featuredImage || null,
      metaTitle: form.metaTitle || null,
      metaDescription: form.metaDescription || null,
      keywords: form.keywords ? form.keywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
    };
    if (editPost) {
      updateMutation.mutate({ id: editPost.id, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const posts = data?.posts ?? [];
  const stats = statsData;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Blog Posts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage SEO-optimised articles for the Msafiri Kenya website</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            title="Import all standard Msafiri Kenya blog articles into this environment"
          >
            <Download className="h-4 w-4" />
            {seedMutation.isPending ? "Seeding…" : "Seed Articles"}
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> New Post
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Total Reads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats?.totalReads?.toLocaleString() ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Globe className="h-4 w-4" /> Published
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-600">{stats?.publishedCount ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileEdit className="h-4 w-4" /> Drafts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-500">{stats?.draftCount ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Posts */}
      {stats && stats.topPosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Top Posts by Reads
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {stats.topPosts.slice(0, 5).map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-6 py-3">
                  <span className="text-muted-foreground text-sm w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.slug}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
                    <Eye className="h-3.5 w-3.5" />
                    {p.readCount.toLocaleString()}
                  </div>
                  <Badge variant={p.status === "published" ? "default" : "secondary"} className="shrink-0 text-xs">
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Posts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Posts</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-12 text-muted-foreground text-sm">Loading…</p>
          ) : posts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No posts yet. Click <strong>New Post</strong> to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Reads</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm leading-snug">{post.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">/{post.slug}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={post.status === "published" ? "default" : "secondary"} className="text-xs">
                        {post.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{post.readCount.toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(post)}>
                            <Edit2 className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          {post.status === "published" && (
                            <DropdownMenuItem asChild>
                              <a href={`/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                                <Eye className="h-4 w-4 mr-2" /> View on site
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeletePost(post)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editPost ? "Edit Post" : "New Blog Post"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Title *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Speed Cameras in Kenya 2024: Complete NTSA List"
                  required
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Slug (URL)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">/blog/</span>
                  <Input
                    value={form.slug}
                    onChange={(e) => { setSlugManuallyEdited(true); setForm((f) => ({ ...f, slug: e.target.value })); }}
                    placeholder="speed-cameras-kenya-2024"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Excerpt (shown on blog listing)</Label>
              <Textarea
                value={form.excerpt}
                onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
                rows={2}
                placeholder="A short description of the article — shown in search results and on the blog listing page."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Content (HTML)</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                rows={12}
                className="font-mono text-xs"
                placeholder="<p>Article content here. You can use HTML tags.</p>"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Author</Label>
                <Input
                  value={form.author}
                  onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
                  placeholder="Msafiri Team"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SEO</p>
              <div className="space-y-1.5">
                <Label>Keywords (comma-separated)</Label>
                <Input
                  value={form.keywords}
                  onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
                  placeholder="NTSA speed cameras Kenya, speed cameras Nairobi, speed trap Kenya 2024"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Meta Title</Label>
                <Input
                  value={form.metaTitle}
                  onChange={(e) => setForm((f) => ({ ...f, metaTitle: e.target.value }))}
                  placeholder="Speed Cameras in Kenya 2024 | Msafiri"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Meta Description</Label>
                <Textarea
                  value={form.metaDescription}
                  onChange={(e) => setForm((f) => ({ ...f, metaDescription: e.target.value }))}
                  rows={2}
                  placeholder="Complete list of NTSA speed camera locations on Kenya's major highways. Know where the cameras are and stay within the limit."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Featured Image</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={form.featuredImage}
                    onChange={(e) => setForm((f) => ({ ...f, featuredImage: e.target.value }))}
                    placeholder="https://... or upload a file →"
                    className="flex-1"
                    disabled={imageUploading}
                  />
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={imageUploading}
                    onClick={() => imageInputRef.current?.click()}
                    className="shrink-0"
                  >
                    {imageUploading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        {Math.round(imageUploadProgress * 100)}%
                      </>
                    ) : (
                      <>
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        Upload
                      </>
                    )}
                  </Button>
                </div>
                {form.featuredImage && (
                  <img
                    src={form.featuredImage}
                    alt="Featured preview"
                    className="mt-1 h-24 rounded-md object-cover border"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editPost ? "Save Changes" : "Create Post"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deletePost} onOpenChange={(o) => !o && setDeletePost(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletePost?.title}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletePost && deleteMutation.mutate(deletePost.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
