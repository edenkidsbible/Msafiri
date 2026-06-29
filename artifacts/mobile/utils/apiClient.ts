import { fetchWithTimeout } from "./fetchTimeout";

// API base URL — constructed from the Replit dev domain injected by the Expo workflow
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
// Replit proxy routes /api/* to the API server (paths = ["/api"] in artifact.toml)
export const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "";

export async function apiGet<T>(path: string, timeoutMs = 10000): Promise<T> {
  if (!API_BASE) throw new Error("API_BASE not configured");
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {}, timeoutMs);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, timeoutMs = 10000): Promise<T> {
  if (!API_BASE) throw new Error("API_BASE not configured");
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}
