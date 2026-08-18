import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, AlertTriangle, Lightbulb, Anchor, Megaphone, Tv2, Search } from "lucide-react";
import { ContentForm } from "@/components/ops/ContentForm";
import { ContentStatusSelect } from "@/components/ops/status-select";
import type { ContentStatus } from "@/components/ops/status-select";

interface ContentItem {
  id: number;
  title: string;
  status: string;
  isCore?: boolean | null;
  pillar?: string | null;
  format?: string | null;
  hook?: string | null;
  angle?: string | null;
  platforms?: string[] | null;
  founderMinutes?: number | null;
  notes?: string | null;
  weekId?: number | null;
}

const PIPELINE_COLS: ContentStatus[] = ["idea", "selected", "brief", "script", "film", "edit", "review", "schedule", "posted"];

type LibTab = "pipeline" | "ideas" | "hooks" | "ctas" | "series";

const PILLAR_COLORS: Record<string, string> = {
  "Road Intelligence": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  "Product / Feature Proof": "bg-primary/10 text-primary",
  "Education / Safety": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Kenyan Driving Reality": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  "Founder / BTS": "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "Community / UGC": "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  "Seasonal Campaign": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "Debate / Mythbusters": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
};

function pillarBadge(pillar?: string | null) {
  if (!pillar) return null;
  const base = Object.keys(PILLAR_COLORS).find(k => pillar.startsWith(k));
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide ${base ? PILLAR_COLORS[base] : "bg-secondary text-secondary-foreground"}`}>
      {pillar.replace(/^(Hook Bank — |CTA Bank — |Series Playbook$)/, "")}
    </span>
  );
}

export default function Content() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<LibTab>("pipeline");
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContentItem | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [pillarFilter, setPillarFilter] = useState("");
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  const { data: currentWeekData } = useQuery<{ id: number; weekNumber: number }>({
    queryKey: ["ops-current-week"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/weeks/current");
      if (!r.ok) throw new Error("Failed to fetch current week");
      return r.json();
    },
  });
  const weekId = currentWeekData?.id ?? 1;

  const { data: allContent, isLoading } = useQuery<{ items: ContentItem[]; total: number }>({
    queryKey: ["ops-content"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/content?limit=2000");
      if (!r.ok) throw new Error("Failed to fetch content");
      return r.json();
    },
  });

  const updateContent = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: object }) => {
      const r = await authFetch(`/api/ops/content/${id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update content");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-content"] });
      qc.invalidateQueries({ queryKey: ["ops-weekly-content"] });
    },
  });

  const openCreate = () => { setEditingItem(undefined); setFormOpen(true); };
  const openEdit = (item: ContentItem) => { setEditingItem(item); setFormOpen(true); };
  const handleClose = () => { setFormOpen(false); setEditingItem(undefined); };

  const handleStatusChange = (item: ContentItem, newStatus: ContentStatus) => {
    if (item.status === newStatus) return;
    setUpdatingIds(s => new Set(s).add(item.id));
    updateContent.mutate(
      { id: item.id, data: { status: newStatus } },
      { onSettled: () => setUpdatingIds(s => { const n = new Set(s); n.delete(item.id); return n; }) }
    );
  };

  const items = allContent?.items ?? [];

  const mainItems = items.filter((c: ContentItem) =>
    !c.pillar?.startsWith("Hook Bank") && !c.pillar?.startsWith("CTA Bank") && !c.pillar?.startsWith("Series Playbook")
  );
  const hookItems = items.filter((c: ContentItem) => c.pillar?.startsWith("Hook Bank"));
  const ctaItems = items.filter((c: ContentItem) => c.pillar?.startsWith("CTA Bank"));
  const seriesItems = items.filter((c: ContentItem) => c.pillar?.startsWith("Series Playbook"));
  const ideaItems = mainItems.filter((c: ContentItem) => c.status === "idea" || c.status === "selected");

  const ideaPillars = [...new Set(ideaItems.map((c: ContentItem) => c.pillar).filter(Boolean))] as string[];

  const tabs = [
    { key: "pipeline" as LibTab, label: "Pipeline", icon: <Tv2 className="w-3.5 h-3.5" />, count: mainItems.filter(c => c.status !== "archive").length },
    { key: "ideas" as LibTab, label: "Ideas", icon: <Lightbulb className="w-3.5 h-3.5" />, count: ideaItems.length },
    { key: "hooks" as LibTab, label: "Hooks", icon: <Anchor className="w-3.5 h-3.5" />, count: hookItems.length },
    { key: "ctas" as LibTab, label: "CTAs", icon: <Megaphone className="w-3.5 h-3.5" />, count: ctaItems.length },
    { key: "series" as LibTab, label: "Series", icon: <AlertTriangle className="w-3.5 h-3.5" />, count: seriesItems.length },
  ];

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  const filteredIdeas = ideaItems.filter((c: ContentItem) => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (pillarFilter && c.pillar !== pillarFilter) return false;
    return true;
  });

  const filteredHooks = hookItems.filter((c: ContentItem) =>
    !search || c.title.toLowerCase().includes(search.toLowerCase()) || (c.hook ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredCtas = ctaItems.filter((c: ContentItem) =>
    !search || c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Content</h1>
          <p className="text-muted-foreground mt-1">Pipeline, idea bank, hooks and CTAs.</p>
        </div>
        <Button onClick={openCreate}><PlusCircle className="w-4 h-4 mr-2" /> Add Content</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(""); setPillarFilter(""); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}{t.label}
            <span className="text-xs opacity-60 ml-0.5">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search + pillar filter */}
      {tab !== "pipeline" && (
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={tab === "hooks" ? "Search hooks…" : tab === "ctas" ? "Search CTAs…" : "Search ideas…"}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {tab === "ideas" && ideaPillars.length > 0 && (
            <select
              value={pillarFilter}
              onChange={e => setPillarFilter(e.target.value)}
              className="h-9 px-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All pillars</option>
              {ideaPillars.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Pipeline tab */}
      {tab === "pipeline" && (
        <div className="flex gap-4 overflow-x-auto pb-6">
          {PIPELINE_COLS.map(col => {
            const colItems = mainItems
              .filter((c: ContentItem) => c.status === col)
              .sort((a: ContentItem, b: ContentItem) => {
                const wa = a.weekId ?? 9999;
                const wb = b.weekId ?? 9999;
                if (wa !== wb) return wa - wb;
                return a.id - b.id;
              });
            return (
              <div key={col} className="flex-1 min-w-[220px] flex flex-col gap-2 p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-semibold text-sm capitalize">{col}</h3>
                  <Badge variant="secondary" className="text-xs">{colItems.length}</Badge>
                </div>
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[60vh]">
                  {colItems.map((c: ContentItem) => (
                    <Card
                      key={c.id}
                      className="cursor-pointer hover:border-primary/40 transition-colors"
                      onClick={() => openEdit(c)}
                    >
                      <CardContent className="p-3 space-y-1.5">
                        <p className="text-xs font-medium leading-snug">{c.title}</p>
                        <div className="flex flex-wrap gap-1">
                          {c.isCore && <span className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded font-semibold">CORE</span>}
                          {pillarBadge(c.pillar)}
                        </div>
                        <div onClick={e => e.stopPropagation()}>
                          <ContentStatusSelect
                            value={c.status as ContentStatus}
                            onChange={v => handleStatusChange(c, v)}
                            disabled={updatingIds.has(c.id)}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {!colItems.length && (
                    <div className="h-16 border-2 border-dashed border-muted rounded-lg flex items-center justify-center text-muted-foreground text-xs">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ideas tab */}
      {tab === "ideas" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredIdeas.map((c: ContentItem) => (
            <Card
              key={c.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => openEdit(c)}
            >
              <CardContent className="p-4 space-y-2">
                <p className="font-medium text-sm">{c.title}</p>
                {c.angle && <p className="text-xs text-muted-foreground line-clamp-2">{c.angle}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  {pillarBadge(c.pillar)}
                  <ContentStatusSelect
                    value={c.status as ContentStatus}
                    onChange={v => handleStatusChange(c, v)}
                    disabled={updatingIds.has(c.id)}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
          {!filteredIdeas.length && (
            <p className="col-span-full text-center text-muted-foreground py-8">No ideas found.</p>
          )}
        </div>
      )}

      {/* Hooks tab */}
      {tab === "hooks" && (
        <div className="space-y-2">
          {filteredHooks.map((c: ContentItem) => (
            <Card key={c.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => openEdit(c)}>
              <CardContent className="p-4 flex items-start gap-3">
                <Anchor className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{c.title}</p>
                  {c.hook && <p className="text-xs text-muted-foreground mt-0.5 italic">"{c.hook}"</p>}
                </div>
              </CardContent>
            </Card>
          ))}
          {!filteredHooks.length && <p className="text-center text-muted-foreground py-8">No hooks found.</p>}
        </div>
      )}

      {/* CTAs tab */}
      {tab === "ctas" && (
        <div className="space-y-2">
          {filteredCtas.map((c: ContentItem) => (
            <Card key={c.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => openEdit(c)}>
              <CardContent className="p-4 flex items-start gap-3">
                <Megaphone className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{c.title}</p>
                  {c.angle && <p className="text-xs text-muted-foreground mt-0.5">{c.angle}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
          {!filteredCtas.length && <p className="text-center text-muted-foreground py-8">No CTAs found.</p>}
        </div>
      )}

      {/* Series tab */}
      {tab === "series" && (
        <div className="space-y-2">
          {seriesItems.map((c: ContentItem) => (
            <Card key={c.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => openEdit(c)}>
              <CardContent className="p-4">
                <p className="font-medium text-sm">{c.title}</p>
                {c.notes && <p className="text-xs text-muted-foreground mt-1">{c.notes}</p>}
              </CardContent>
            </Card>
          ))}
          {!seriesItems.length && <p className="text-center text-muted-foreground py-8">No series found.</p>}
        </div>
      )}

      <ContentForm open={formOpen} onClose={handleClose} item={editingItem} currentWeekId={weekId} />
    </div>
  );
}
