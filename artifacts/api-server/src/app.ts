import * as Sentry from "@sentry/node";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

// ── Sentry — initialise before any other middleware so all errors are captured.
// Gated on SENTRY_DSN so the server starts cleanly in local dev without a DSN.
const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    // Errors only — no performance tracing on the free plan
    tracesSampleRate: 0,
    beforeSend(event) {
      // Strip GPS coordinates from every context/extra dict so precise driver
      // locations never reach the Sentry dashboard.
      const GPS_FIELDS = ["lat", "lng", "latitude", "longitude", "location", "coords", "accuracy"];
      if (event.contexts) {
        for (const ctx of Object.values(event.contexts)) {
          if (ctx && typeof ctx === "object") {
            for (const f of GPS_FIELDS) delete (ctx as Record<string, unknown>)[f];
          }
        }
      }
      if (event.extra) {
        for (const f of GPS_FIELDS) delete event.extra[f];
      }
      return event;
    },
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Course-image PNGs rendered from the PDF — served directly (not under /api/
// because they are static assets, but proxied by the same domain).
app.use(
  "/api/course-images",
  express.static(path.join(__dirname, "../public/course-images"), {
    maxAge: "7d",
    immutable: true,
  })
);

app.use("/api", router);

// Sentry error handler must come after all routes and other middleware.
// It captures any unhandled Express errors and forwards them to Sentry.
if (SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

export default app;
