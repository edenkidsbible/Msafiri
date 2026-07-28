/**
 * Friendly full-page fallback rendered by the Sentry ErrorBoundary when the
 * admin UI crashes. The crash has already been reported to Sentry by the
 * boundary — this screen just keeps the admin out of a blank white page.
 */
export function ErrorFallback({ resetError }: { resetError: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <div className="text-5xl">⚠️</div>
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        An unexpected error occurred and has been reported to the team. You can
        try again, or reload the page if the problem persists.
      </p>
      <div className="flex gap-3">
        <button
          onClick={resetError}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
