// Shared "time ago" formatter for community report ages across the app.
// Scales the unit up as the value grows so a permanent report (e.g. a speed
// camera, which never expires) reads as "2 weeks ago" or "3 months ago"
// instead of an unreadable "352h ago".
export function formatTimeAgo(ts: number, nowTs: number = Date.now()): string {
  const diffMs = Math.max(0, nowTs - ts);
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "Yesterday" : `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;

  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
