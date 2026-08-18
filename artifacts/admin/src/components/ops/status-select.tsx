/**
 * Inline status selector — renders a styled badge that opens a dropdown.
 * Calls an onStatusChange callback; parent owns the mutation.
 */
import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";
export type ContentStatus = "idea" | "selected" | "brief" | "script" | "film" | "edit" | "review" | "schedule" | "posted" | "measured" | "archive";
export type TripStatus = "planned" | "in_progress" | "completed" | "cancelled";

const TASK_STATUSES: { value: TaskStatus; label: string; color: string }[] = [
  { value: "backlog",     label: "Backlog",     color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  { value: "todo",        label: "To Do",       color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "in_progress", label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "done",        label: "Done ✓",      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "cancelled",   label: "Cancelled",   color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" },
];

const CONTENT_STATUSES: { value: ContentStatus; label: string; color: string }[] = [
  { value: "idea",     label: "Idea",     color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  { value: "selected", label: "Selected", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "brief",    label: "Brief",    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { value: "script",   label: "Script",   color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  { value: "film",     label: "Film",     color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  { value: "edit",     label: "Edit",     color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "review",   label: "Review",   color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300" },
  { value: "schedule", label: "Schedule", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  { value: "posted",   label: "Posted ✓", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "measured", label: "Measured", color: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  { value: "archive",  label: "Archive",  color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
];

const TRIP_STATUSES: { value: TripStatus; label: string; color: string }[] = [
  { value: "planned",     label: "Planned",     color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "in_progress", label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "completed",   label: "Completed ✓", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "cancelled",   label: "Cancelled",   color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" },
];

interface StatusSelectProps<T extends string> {
  value: T;
  options: { value: T; label: string; color: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

function StatusSelectBase<T extends string>({ value, options, onChange, disabled, size = "sm" }: StatusSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        disabled={disabled}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-medium transition-all ring-1 ring-inset ring-transparent",
          "hover:ring-current/30 focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          current.color,
          size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1"
        )}
      >
        {current.label}
        <ChevronDown className={cn("shrink-0 transition-transform", size === "sm" ? "w-3 h-3" : "w-4 h-4", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 min-w-[140px] bg-popover border rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={e => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium hover:bg-muted transition-colors text-left",
                opt.value === value && "bg-muted/60"
              )}
            >
              <span className={cn("inline-block rounded-full px-2 py-0.5", opt.color)}>{opt.label}</span>
              {opt.value === value && <Check className="w-3 h-3 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskStatusSelect({ value, onChange, disabled }: {
  value: TaskStatus; onChange: (v: TaskStatus) => void; disabled?: boolean;
}) {
  return <StatusSelectBase value={value} options={TASK_STATUSES} onChange={onChange} disabled={disabled} />;
}

export function ContentStatusSelect({ value, onChange, disabled, size }: {
  value: ContentStatus; onChange: (v: ContentStatus) => void; disabled?: boolean; size?: "sm" | "md";
}) {
  return <StatusSelectBase value={value} options={CONTENT_STATUSES} onChange={onChange} disabled={disabled} size={size} />;
}

export function TripStatusSelect({ value, onChange, disabled }: {
  value: TripStatus; onChange: (v: TripStatus) => void; disabled?: boolean;
}) {
  return <StatusSelectBase value={value} options={TRIP_STATUSES} onChange={onChange} disabled={disabled} />;
}

export { TASK_STATUSES, CONTENT_STATUSES, TRIP_STATUSES };
