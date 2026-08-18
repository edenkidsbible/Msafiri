import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2 } from "lucide-react";

type ContentItemInputStatus = "idea" | "selected" | "brief" | "script" | "film" | "edit" | "review" | "schedule" | "posted" | "measured" | "archive";

const PLATFORMS = ["youtube", "instagram", "tiktok", "twitter", "linkedin", "whatsapp"];

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

interface ContentFormProps {
  open: boolean;
  onClose: () => void;
  item?: ContentItem;
  currentWeekId?: number;
}

export function ContentForm({ open, onClose, item, currentWeekId }: ContentFormProps) {
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [form, setForm] = useState({
    title: item?.title ?? "",
    status: (item?.status ?? "idea") as ContentItemInputStatus,
    isCore: item?.isCore ?? false,
    pillar: item?.pillar ?? "",
    format: item?.format ?? "",
    hook: item?.hook ?? "",
    angle: item?.angle ?? "",
    platforms: item?.platforms ?? [] as string[],
    founderMinutes: item?.founderMinutes?.toString() ?? "",
    notes: item?.notes ?? "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        title: item?.title ?? "",
        status: (item?.status ?? "idea") as ContentItemInputStatus,
        isCore: item?.isCore ?? false,
        pillar: item?.pillar ?? "",
        format: item?.format ?? "",
        hook: item?.hook ?? "",
        angle: item?.angle ?? "",
        platforms: item?.platforms ?? [],
        founderMinutes: item?.founderMinutes?.toString() ?? "",
        notes: item?.notes ?? "",
      });
    }
  }, [open, item]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ops-content"] });
    qc.invalidateQueries({ queryKey: ["ops-weekly-content"] });
    qc.invalidateQueries({ queryKey: ["dashboard-focus"] });
  };

  const togglePlatform = (p: string) => {
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(p) ? f.platforms.filter(x => x !== p) : [...f.platforms, p],
    }));
  };

  const createItem = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch("/api/ops/content", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create content item");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const updateItem = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch(`/api/ops/content/${item!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update content item");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const deleteItem = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`/api/ops/content/${item!.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete content item");
    },
    onSuccess: () => { invalidate(); setDeleteOpen(false); onClose(); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    const payload = {
      title: form.title,
      status: form.status,
      isCore: form.isCore,
      weekId: item ? (item.weekId ?? undefined) : currentWeekId,
      pillar: form.pillar || undefined,
      format: form.format || undefined,
      hook: form.hook || undefined,
      angle: form.angle || undefined,
      platforms: form.platforms.length ? form.platforms : undefined,
      founderMinutes: form.founderMinutes ? parseInt(form.founderMinutes) : undefined,
      notes: form.notes || undefined,
    };
    if (item) {
      await updateItem.mutateAsync(payload);
    } else {
      await createItem.mutateAsync(payload);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    await deleteItem.mutateAsync();
  };

  const isLoading = createItem.isPending || updateItem.isPending;

  return (
    <>
      <FormDialog open={open} onClose={onClose} title={item ? "Edit Content Item" : "Add Content Item"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input
              placeholder="Content title"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as ContentItemInputStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="idea">Idea</SelectItem>
                  <SelectItem value="selected">Selected</SelectItem>
                  <SelectItem value="brief">Brief</SelectItem>
                  <SelectItem value="script">Script</SelectItem>
                  <SelectItem value="film">Film</SelectItem>
                  <SelectItem value="edit">Edit</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="schedule">Schedule</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                  <SelectItem value="measured">Measured</SelectItem>
                  <SelectItem value="archive">Archive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Input
                placeholder="e.g. Short, Reel, Thread"
                value={form.format}
                onChange={e => setForm(f => ({ ...f, format: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Pillar</Label>
            <Input
              placeholder="e.g. Road Intelligence, Founder / BTS"
              value={form.pillar}
              onChange={e => setForm(f => ({ ...f, pillar: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Hook</Label>
            <Input
              placeholder="Opening hook"
              value={form.hook}
              onChange={e => setForm(f => ({ ...f, hook: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Angle</Label>
            <Input
              placeholder="Content angle / POV"
              value={form.angle}
              onChange={e => setForm(f => ({ ...f, angle: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                    form.platforms.includes(p)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Founder Minutes</Label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={form.founderMinutes}
              onChange={e => setForm(f => ({ ...f, founderMinutes: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              placeholder="Optional notes"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="isCore"
              checked={form.isCore}
              onCheckedChange={v => setForm(f => ({ ...f, isCore: !!v }))}
            />
            <Label htmlFor="isCore">Mark as Core Piece (counts toward 4/week limit)</Label>
          </div>

          <FormDialogFooter>
            <div>
              {item && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {item ? "Save Changes" : "Add Content"}
              </Button>
            </div>
          </FormDialogFooter>
        </form>
      </FormDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Content Item?</AlertDialogTitle>
            <AlertDialogDescription>This content item will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
