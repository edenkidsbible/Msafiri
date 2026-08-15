/**
 * Legacy /link-phone route — redirects to the new /link-email screen.
 * Phone-based recovery has been replaced with email-based recovery.
 * This file is kept so any existing deep-links or bookmarks still work.
 */
export { ErrorBoundary } from "@/components/ErrorBoundary";
import { useEffect } from "react";
import { router } from "expo-router";

export default function LinkPhoneLegacyRedirect() {
  useEffect(() => {
    router.replace("/link-email" as any);
  }, []);
  return null;
}
