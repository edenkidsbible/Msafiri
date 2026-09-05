export interface OptionalUpdatePrompt {
  version: string;
  releaseNotes: string;
  storeUrlIos: string;
  storeUrlAndroid: string;
}

let pendingPrompt: OptionalUpdatePrompt | null = null;
const listeners = new Set<(prompt: OptionalUpdatePrompt) => void>();

export function requestOptionalUpdatePrompt(prompt: OptionalUpdatePrompt): void {
  pendingPrompt = prompt;
  for (const listener of listeners) listener(prompt);
}

export function getPendingOptionalUpdatePrompt(): OptionalUpdatePrompt | null {
  return pendingPrompt;
}

export function clearPendingOptionalUpdatePrompt(): void {
  pendingPrompt = null;
}

export function subscribeOptionalUpdatePrompt(
  listener: (prompt: OptionalUpdatePrompt) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}