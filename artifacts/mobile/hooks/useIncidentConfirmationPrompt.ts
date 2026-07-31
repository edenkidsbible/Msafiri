import { useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";

const PROXIMITY_M = 200;
// Poll interval for proximity checks. 3 s gives sub-second-accurate detection
// at city driving speeds (≤60 km/h ≈ 50 m/3 s) without running on every GPS
// fix. Far cheaper than the previous 1 Hz re-run via state deps.
const CHECK_INTERVAL_MS = 3000;

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
    setPendingConfirmationSource,
    markReportPrompted,
    isReportPrompted,
  } = useApp();

  // Stable refs so the interval can always read the latest GPS position and
  // report state without restarting on every 1 Hz GPS fix.
  const latRef = useRef(currentLat);
  const lngRef = useRef(currentLng);
  useEffect(() => { latRef.current = currentLat; }, [currentLat]);
  useEffect(() => { lngRef.current = currentLng; }, [currentLng]);

  const reportsRef = useRef(communityReports);
  useEffect(() => { reportsRef.current = communityReports; }, [communityReports]);

  const pendingRef = useRef(pendingConfirmationReport);
  useEffect(() => { pendingRef.current = pendingConfirmationReport; }, [pendingConfirmationReport]);

  // Use stable refs for the callback helpers too so the interval doesn't need
  // them in its deps (they are stable from AppContext but the ref avoids any
  // future breaking change).
  const isReportPromptedRef = useRef(isReportPrompted);
  useEffect(() => { isReportPromptedRef.current = isReportPrompted; }, [isReportPrompted]);
  const hasVotedOnReportRef = useRef(hasVotedOnReport);
  useEffect(() => { hasVotedOnReportRef.current = hasVotedOnReport; }, [hasVotedOnReport]);
  const markReportPromptedRef = useRef(markReportPrompted);
  useEffect(() => { markReportPromptedRef.current = markReportPrompted; }, [markReportPrompted]);
  const setPendingConfirmationReportRef = useRef(setPendingConfirmationReport);
  useEffect(() => { setPendingConfirmationReportRef.current = setPendingConfirmationReport; }, [setPendingConfirmationReport]);
  const setPendingConfirmationSourceRef = useRef(setPendingConfirmationSource);
  useEffect(() => { setPendingConfirmationSourceRef.current = setPendingConfirmationSource; }, [setPendingConfirmationSource]);

  useEffect(() => {
    const check = () => {
      const lat = latRef.current;
      const lng = lngRef.current;
      if (lat == null || lng == null) return;
      if (pendingRef.current != null) return;

      for (const report of reportsRef.current) {
        if (report.isOwn) continue;
        if (report.status === "expired" || report.status === "denied") continue;
        if (report.type === "camera") continue;

        const id = report.serverId ?? report.id;
        if (isReportPromptedRef.current(id)) continue;
        if (hasVotedOnReportRef.current(id) || hasVotedOnReportRef.current(report.id)) continue;

        const dist = haversine(lat, lng, report.lat, report.lng);
        if (dist <= PROXIMITY_M) {
          markReportPromptedRef.current(id);
          setPendingConfirmationSourceRef.current("proximity");
          setPendingConfirmationReportRef.current(report);
          break;
        }
      }
    };

    // Run immediately, then on a fixed interval. This catches the driver
    // passing a report between report-list refreshes without re-running on
    // every 1 Hz GPS state update.
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
    // Empty deps: the interval runs for the lifetime of this hook. All mutable
    // values are read from refs that stay current via separate effects above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDismissed = (reportId: string) => {
    markReportPrompted(reportId);
  };

  return { markDismissed };
}
