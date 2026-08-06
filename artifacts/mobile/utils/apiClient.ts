import { fetchWithTimeout } from "./fetchTimeout";

// API base URL — constructed from the Replit dev domain injected by the Expo workflow
const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
// Replit proxy routes /api/* to the API server (paths = ["/api"] in artifact.toml)
export const API_BASE = DOMAIN ? `https://${DOMAIN}/api` : "";

// Thrown instead of a bare Error on a non-2xx response so callers can branch
// on the HTTP status and the server's error message (e.g. to distinguish a
// blocked-device 403 from a generic network failure) without re-parsing the
// response themselves.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function throwApiError(res: Response): Promise<never> {
  let message = `API ${res.status}`;
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") message = body.error;
  } catch { /* non-JSON error body — fall back to generic message */ }
  throw new ApiError(res.status, message);
}

export async function apiGet<T>(path: string, timeoutMs = 10000): Promise<T> {
  if (!API_BASE) throw new Error("API_BASE not configured");
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {}, timeoutMs);
  if (!res.ok) return throwApiError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, timeoutMs = 10000): Promise<T> {
  if (!API_BASE) throw new Error("API_BASE not configured");
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) return throwApiError(res);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown, timeoutMs = 10000): Promise<T> {
  if (!API_BASE) throw new Error("API_BASE not configured");
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) return throwApiError(res);
  return res.json() as Promise<T>;
}

// Parse a response body that may legitimately be empty (204 No Content or a
// zero-length body). Returns undefined in that case instead of letting
// res.json() throw on the empty body — DELETE endpoints commonly return 204.
async function parseMaybeEmpty<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function apiDelete<T>(path: string, body: unknown, timeoutMs = 10000): Promise<T> {
  if (!API_BASE) throw new Error("API_BASE not configured");
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) return throwApiError(res);
  return parseMaybeEmpty<T>(res);
}
