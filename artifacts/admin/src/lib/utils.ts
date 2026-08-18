import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number or numeric string as Kenyan Shillings (KES) */
export function formatKes(v: string | number | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "KES 0";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}
