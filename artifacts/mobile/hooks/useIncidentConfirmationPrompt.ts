import { useEffect } from "react";
import { useApp } from "@/context/AppContext";

const PROXIMITY_M = 200;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const f1 = (lat1 * Math.PI) / 180, f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180, dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useIncidentConfirmationPrompt() {
  const {
    currentLat, currentLng,
    communityReports,
    hasVotedOnReport,
    pendingConfirmationReport,
    setPendingConfirmationReport,
    markReportPrompted,
    isReportPrompted,
  } = useApp();

  useEffect(() => {
    if (currentLat == null || currentLng == null) return;
    if (pendingConfirmationReport != null) return;

    for (const report of communityReports) {
      if (report.isOwn) continue;
      if (report.status === "expired" || report.status === "denied") continue;
      if (report.type === "camera") continue;

      const id = report.serverId ?? report.id;
      if (isReportPrompted(id)) continue;
      if (hasVotedOnReport(id) || hasVotedOnReport(report.id)) continue;

      const dist = haversine(currentLat, currentLng, report.lat, report.lng);
      if (dist <= PROXIMITY_M) {
        markReportPrompted(id);
        setPendingConfirmationReport(report);
        break;
      }
    }
  }, [currentLat, currentLng, communityReports, pendingConfirmationReport]);

  const markDismissed = (reportId: string) => {
    markReportPrompted(reportId);
  };

  return { markDismissed };
}
