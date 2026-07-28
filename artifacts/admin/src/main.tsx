import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupApiClient } from "./lib/auth";
import { initSentry, Sentry } from "./lib/sentry";
import { ErrorFallback } from "./components/ErrorFallback";
import App from "./App";
import "./index.css";

// Initialise Sentry before anything else so all errors are captured.
// No-op when VITE_SENTRY_DSN is absent; the ErrorBoundary still works.
initSentry();

setupApiClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback resetError={resetError} />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
);
