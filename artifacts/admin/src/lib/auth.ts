import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';

const TOKEN_KEY = 'sd_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getUser(): { id: string; email: string; name: string; role: string; mustChangePassword?: boolean } | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function setupApiClient() {
  // Hooks already use absolute /api/* paths — no base URL prefix needed in browser
  setBaseUrl(null);
  setAuthTokenGetter(() => getToken());
}
