// Re-export the real hook from the RevenueCat library so any file that
// imports from "@/hooks/useSubscription" gets the context-backed version.
export { useSubscription } from "@/lib/revenuecat";
