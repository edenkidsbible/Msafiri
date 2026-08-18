/**
 * FormDialog — centered modal for all create/edit forms.
 * Replaces the side-panel Sheet pattern so nothing gets clipped.
 * Closes on backdrop click or Escape key.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Extra width class, e.g. "max-w-2xl". Default: "max-w-lg" */
  width?: string;
  children: React.ReactNode;
}

export function FormDialog({ open, onClose, title, description, width = "max-w-lg", children }: FormDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  /* Close on Escape */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  /* Lock body scroll while open */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px] animate-in fade-in-0"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "relative z-10 w-full bg-background border rounded-xl shadow-2xl",
          "flex flex-col max-h-[92dvh]",
          "animate-in fade-in-0 zoom-in-95 duration-200",
          width,
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b shrink-0">
          <div>
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors rounded-sm focus:outline-none focus:ring-2 focus:ring-ring mt-0.5"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Sticky footer row inside FormDialog — place at the bottom of your form */
export function FormDialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 pt-5 mt-2 border-t", className)}>
      {children}
    </div>
  );
}
