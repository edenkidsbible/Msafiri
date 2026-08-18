import { AdminLayout } from "@/components/layout/admin-layout";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Search, LayoutList, Columns } from "lucide-react";
import { TaskForm } from "@/components/ops/TaskForm";
import { TaskStatusSelect } from "@/components/ops/status-select";
import type { TaskStatus } from "@/components/ops/status-select";
import { AssigneeSelect } from "@/components/ops/assignee-badge";

interface Task {
  id: number;
  title: string;
  description?: string | null;
  priority: string;
  module: string;
  type?: string | null;
  status: string;
  dueDate?: string | null;
  estimatedHours?: number | null;
  assignedTo?: string | null;
  position?: number | null;
}

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-destructive",
  high: "bg-primary",
  medium: "bg-amber-500",
  low: "bg-muted-foreground/50",
};

const MODULE_TABS = [
  { key: "", label: "All" },
  { key: "product", label: "Product" },
  { key: "compliance", label: "Compliance" },
  { key: "risk", label: "Risk" },
  { key: "growth", label: "Growth" },
  { key: "content", label: "Content" },
  { key: "partnership", label: "Partners" },
  { key: "finance", label: "Finance" },
];

const KANBAN_COLS = ["backlog", "todo", "in_progress", "done"];
const KANBAN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export default function Tasks() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);
  const [filter, setFilter] = useState("");
  const [activeModule, setActiveModule] = useState("");
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<{ items: Task[]; total: number }>({
    queryKey: ["ops-tasks"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/tasks?limit=500");
      if (!r.ok) throw new Error("Failed to fetch tasks");
      return r.json();
    },
  });

  const { data: stats } = useQuery<{ total: number; byStatus: Record<string, number>; byPriority: Record<string, number>; overdue: number }>({
    queryKey: ["ops-task-stats"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/tasks/stats");
      if (!r.ok) throw new Error("Failed to fetch task stats");
      return r.json();
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: object }) => {
      const r = await authFetch(`/api/ops/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update task");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-tasks"] });
      qc.invalidateQueries({ queryKey: ["ops-task-stats"] });
    },
  });

  const allItems = data?.items ?? [];

  const openEdit = (task: Task) => { setEditingTask(task); setFormOpen(true); };
  const openCreate = () => { setEditingTask(undefined); setFormOpen(true); };
  const handleClose = () => { setFormOpen(false); setEditingTask(undefined); };

  const handleStatusChange = (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    setUpdatingIds(s => new Set(s).add(task.id));
    updateTask.mutate(
      { id: task.id, data: { status } },
      { onSettled: () => setUpdatingIds(s => { const n = new Set(s); n.delete(task.id); return n; }) }
    );
  };

  const handleAssigneeChange = (task: Task, name: string | null) => {
    updateTask.mutate({ id: task.id, data: { assignedTo: name } });
  };

  const filtered = allItems.filter(t => {
    if (activeModule && t.module !== activeModule) return false;
    if (filter && !t.title.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const knownAssignees = [...new Set(allItems.map(t => t.assignedTo).filter((a): a is string => !!a))];

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <AdminLayout>
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground mt-1">
            {stats?.total ?? 0} tasks · {stats?.overdue ?? 0} overdue
          </p>
        </div>
        <div className="flex gap-2">
          <div className="border rounded-lg p-0.5 flex">
            <button
              onClick={() => setView("list")}
              className={`px-2.5 py-1.5 rounded text-sm flex items-center gap-1 transition-colors ${view === "list" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutList className="w-4 h-4" /> List
            </button>
            <button
              onClick={() => setView("kanban")}
              className={`px-2.5 py-1.5 rounded text-sm flex items-center gap-1 transition-colors ${view === "kanban" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Columns className="w-4 h-4" /> Kanban
            </button>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <PlusCircle className="w-4 h-4" /> Add Task
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-3 flex-wrap">
          {Object.entries(stats.byStatus ?? {}).map(([status, count]) => (
            <div key={status} className="text-xs">
              <span className="text-muted-foreground capitalize">{status.replace("_", " ")}</span>{" "}
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Module tabs + search */}
      <div className="space-y-3">
        <div className="flex gap-1 flex-wrap border-b">
          {MODULE_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveModule(tab.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                activeModule === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.key && allItems.filter(t => t.module === tab.key).length > 0 && (
                <span className="ml-1.5 text-xs opacity-60">{allItems.filter(t => t.module === tab.key).length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tasks…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full h-9 pl-9 pr-4 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* List view */}
      {view === "list" ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left font-medium p-4 text-muted-foreground">Task</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Module</th>
                <th className="text-left font-medium p-4 text-muted-foreground">Status</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden sm:table-cell">Priority</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden lg:table-cell">Assignee</th>
                <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(task => (
                <tr
                  key={task.id}
                  className="hover:bg-muted/20 cursor-pointer transition-colors group"
                  onClick={() => openEdit(task)}
                >
                  <td className="p-4">
                    <div className="flex items-start gap-2">
                      <div className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.low}`} />
                      <span className={`font-medium ${task.status === "done" || task.status === "cancelled" ? "line-through text-muted-foreground" : ""}`}>
                        {task.title}
                      </span>
                    </div>
                  </td>
                  <td className="p-4 hidden md:table-cell">
                    <span className="capitalize text-xs text-muted-foreground">{task.module}</span>
                  </td>
                  <td className="p-4" onClick={e => e.stopPropagation()}>
                    <TaskStatusSelect
                      value={task.status as TaskStatus}
                      onChange={v => handleStatusChange(task, v)}
                      disabled={updatingIds.has(task.id)}
                    />
                  </td>
                  <td className="p-4 hidden sm:table-cell">
                    <Badge variant="outline" className="text-xs capitalize">{task.priority}</Badge>
                  </td>
                  <td className="p-4 hidden lg:table-cell" onClick={e => e.stopPropagation()}>
                    <AssigneeSelect
                      current={task.assignedTo}
                      knownNames={knownAssignees}
                      onSave={name => handleAssigneeChange(task, name)}
                    />
                  </td>
                  <td className="p-4 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {task.dueDate ? new Date(task.dueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-muted-foreground">
                    {filter || activeModule ? "No tasks match your filter." : "No tasks yet — add one to get started."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Kanban view */
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[480px]">
          {KANBAN_COLS.map(col => {
            const colTasks = filtered.filter(t => t.status === col);
            return (
              <div key={col} className="flex-1 min-w-[260px] flex flex-col gap-2 p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between px-1 mb-1">
                  <h3 className="font-semibold text-sm">{KANBAN_LABELS[col]}</h3>
                  <Badge variant="secondary" className="px-1.5 min-w-6 justify-center text-xs">{colTasks.length}</Badge>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto">
                  {colTasks.map(task => (
                    <Card
                      key={task.id}
                      className={`cursor-pointer transition-colors ${task.status === "done" ? "opacity-60" : "hover:border-primary/40"}`}
                      onClick={() => openEdit(task)}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className={`shrink-0 w-2 h-2 mt-1.5 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.low}`} />
                          <p className={`text-sm font-medium leading-snug flex-1 ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                            {task.title}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2" onClick={e => e.stopPropagation()}>
                          <TaskStatusSelect
                            value={task.status as TaskStatus}
                            onChange={v => handleStatusChange(task, v)}
                            disabled={updatingIds.has(task.id)}
                          />
                          <AssigneeSelect
                            current={task.assignedTo}
                            knownNames={knownAssignees}
                            onSave={name => handleAssigneeChange(task, name)}
                          />
                        </div>
                        {task.module && (
                          <span className="text-[10px] text-muted-foreground capitalize bg-secondary px-1.5 py-0.5 rounded">{task.module}</span>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                  {!colTasks.length && (
                    <div className="h-20 border-2 border-dashed border-muted rounded-lg flex items-center justify-center text-muted-foreground text-xs">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskForm open={formOpen} onClose={handleClose} task={editingTask} />
    </div>
    </AdminLayout>
  );
}
