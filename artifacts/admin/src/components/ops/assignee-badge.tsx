/**
 * AssigneeBadge — shows a coloured avatar circle with initials for a task assignee.
 * Also exports AssigneeSelect for inline reassign without opening the full form.
 */
import { useState, useRef, useEffect } from "react";
import { UserCircle2, X } from "lucide-react";

// ── Colour derivation ─────────────────────────────────────────────────────────

const COLOURS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-rose-500", "bg-indigo-500",
  "bg-amber-500", "bg-cyan-500",
];

function nameToColour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLOURS[Math.abs(h) % COLOURS.length];
}

function nameToInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── AssigneeBadge ─────────────────────────────────────────────────────────────

interface AssigneeBadgeProps {
  name: string;
  size?: "sm" | "md";
  showName?: boolean;
  className?: string;
}

export function AssigneeBadge({ name, size = "sm", showName = false, className = "" }: AssigneeBadgeProps) {
  if (!name?.trim()) return null;
  const dim = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={name}>
      <span className={`${dim} ${nameToColour(name)} rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none`}>
        {nameToInitials(name)}
      </span>
      {showName && <span className="text-xs text-muted-foreground truncate max-w-[80px]">{name}</span>}
    </span>
  );
}

// ── AssigneeSelect — inline popover for quick reassign ───────────────────────

interface AssigneeSelectProps {
  current: string | null | undefined;
  knownNames?: string[];
  onSave: (name: string | null) => void;
  disabled?: boolean;
}

export function AssigneeSelect({ current, knownNames = [], onSave, disabled }: AssigneeSelectProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(current ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInput(current ?? "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, current]);

  const commit = () => {
    const val = input.trim() || null;
    onSave(val);
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSave(null);
    setInput("");
    setOpen(false);
  };

  if (disabled) {
    return current ? <AssigneeBadge name={current} showName /> : (
      <span className="text-xs text-muted-foreground/50 flex items-center gap-1"><UserCircle2 className="w-3.5 h-3.5" />Unassigned</span>
    );
  }

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        title={current ? `Assigned to ${current} — click to reassign` : "Click to assign"}
      >
        {current ? (
          <AssigneeBadge name={current} showName />
        ) : (
          <span className="flex items-center gap-1 opacity-50 hover:opacity-100">
            <UserCircle2 className="w-3.5 h-3.5" />
            <span>Assign</span>
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute z-50 top-7 left-0 bg-popover border rounded-lg shadow-lg p-2 w-52"
          onMouseDown={e => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Name…"
            className="w-full text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {knownNames.length > 0 && (
            <div className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
              {knownNames
                .filter(n => n.toLowerCase().includes(input.toLowerCase()))
                .map(n => (
                  <button
                    key={n}
                    type="button"
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted flex items-center gap-2"
                    onClick={() => { onSave(n); setOpen(false); }}
                  >
                    <AssigneeBadge name={n} />
                    {n}
                  </button>
                ))}
            </div>
          )}
          <div className="flex gap-1 mt-2">
            <button
              type="button"
              className="flex-1 text-xs bg-primary text-primary-foreground rounded py-1 hover:bg-primary/90"
              onClick={commit}
            >
              Save
            </button>
            {current && (
              <button
                type="button"
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                onClick={clear}
                title="Clear assignee"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
