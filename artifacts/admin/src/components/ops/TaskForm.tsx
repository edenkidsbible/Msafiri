import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Trash2 } from "lucide-react";

type TaskInputPriority = "critical" | "high" | "medium" | "low";
type TaskInputModule = "product" | "compliance" | "risk" | "growth" | "content" | "partnership" | "finance" | "other";
type TaskInputType = "feature" | "bug" | "research" | "admin" | "field" | "content";
type TaskInputStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";

interface Task {
  id: number;
  title: string;
  description?: string | null;
  priority: string;
  module?: string | null;
  type?: string | null;
  status: string;
  dueDate?: string | null;
  estimatedHours?: number | null;
  assignedTo?: string | null;
}

interface TaskFormProps {
  open: boolean;
  onClose: () => void;
  task?: Task;
}

export function TaskForm({ open, onClose, task }: TaskFormProps) {
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: (task?.priority ?? "medium") as TaskInputPriority,
    module: (task?.module ?? "other") as TaskInputModule,
    type: (task?.type ?? "admin") as TaskInputType,
    status: (task?.status ?? "todo") as TaskInputStatus,
    dueDate: task?.dueDate?.split("T")[0] ?? "",
    estimatedHours: task?.estimatedHours?.toString() ?? "",
    assignedTo: task?.assignedTo ?? "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        title: task?.title ?? "",
        description: task?.description ?? "",
        priority: (task?.priority ?? "medium") as TaskInputPriority,
        module: (task?.module ?? "other") as TaskInputModule,
        type: (task?.type ?? "admin") as TaskInputType,
        status: (task?.status ?? "todo") as TaskInputStatus,
        dueDate: task?.dueDate?.split("T")[0] ?? "",
        estimatedHours: task?.estimatedHours?.toString() ?? "",
        assignedTo: task?.assignedTo ?? "",
      });
    }
  }, [open, task]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ops-tasks"] });
    qc.invalidateQueries({ queryKey: ["ops-task-stats"] });
    qc.invalidateQueries({ queryKey: ["dashboard-focus"] });
  };

  const createTask = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch("/api/ops/tasks", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create task");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const updateTask = useMutation({
    mutationFn: async (data: object) => {
      const r = await authFetch(`/api/ops/tasks/${task!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update task");
      return r.json();
    },
    onSuccess: () => { invalidate(); onClose(); },
  });

  const deleteTask = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`/api/ops/tasks/${task!.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete task");
    },
    onSuccess: () => { invalidate(); setDeleteOpen(false); onClose(); },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    const payload = {
      title: form.title,
      description: form.description || undefined,
      priority: form.priority,
      module: form.module,
      type: form.type,
      status: form.status,
      dueDate: form.dueDate || undefined,
      estimatedHours: form.estimatedHours ? parseFloat(form.estimatedHours) : undefined,
      assignedTo: form.assignedTo.trim() || undefined,
    };
    if (task) {
      await updateTask.mutateAsync(payload);
    } else {
      await createTask.mutateAsync(payload);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    await deleteTask.mutateAsync();
  };

  const isLoading = createTask.isPending || updateTask.isPending;

  return (
    <>
      <FormDialog open={open} onClose={onClose} title={task ? "Edit Task" : "Add Task"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input
              placeholder="Task title"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Optional details"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as TaskInputPriority }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as TaskInputStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Module</Label>
              <Select value={form.module} onValueChange={v => setForm(f => ({ ...f, module: v as TaskInputModule }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="risk">Risk</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="content">Content</SelectItem>
                  <SelectItem value="partnership">Partnership</SelectItem>
                  <SelectItem value="finance">Finance</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as TaskInputType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="research">Research</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="field">Field</SelectItem>
                  <SelectItem value="content">Content</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Est. Hours</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                placeholder="0"
                value={form.estimatedHours}
                onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Assigned To</Label>
            <Input
              placeholder="e.g. Brian, Wanjiku Mwangi…"
              value={form.assignedTo}
              onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
            />
          </div>

          <FormDialogFooter>
            <div>
              {task && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {task ? "Save Changes" : "Add Task"}
              </Button>
            </div>
          </FormDialogFooter>
        </form>
      </FormDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>This task will be permanently deleted.</AlertDialogDescription>
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
