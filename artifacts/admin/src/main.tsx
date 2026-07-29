import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { setupApiClient } from "./lib/auth";
import { initSentry } from "./lib/sentry";
import { ErrorFallback } from "./components/ErrorFallback";
import App from "./App";
import "./index.css";

// No-op — kept so lib/sentry import is preserved for future re-enabling.
initSentry();

setupApiClient();

// ── Plain React ErrorBoundary (replaces Sentry.ErrorBoundary) ──────────────
interface EBState { hasError: boolean; resetKey: number }
class AppErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false, resetKey: 0 };
  static getDerivedStateFromError(): Partial<EBState> { return { hasError: true }; }
  reset = () => this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }));
  render() {
    if (this.state.hasError) return <ErrorFallback resetError={this.reset} />;
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
