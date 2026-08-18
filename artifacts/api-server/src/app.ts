import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import clipRedirectRouter from "./routes/clipRedirect.js";
import inboundEmailRouter from "./routes/inbound-email.js";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

// Trust the first proxy hop so req.ip reflects the real client address when
// deployed behind Replit/nginx. This is used for rate limiting.
app.set("trust proxy", 1);

// ── Security headers (helmet) ──────────────────────────────────────────────────
app.use(
  helmet({
    // Allow loading assets from same origin; disable strict CSP so API JSON
    // responses aren't blocked when browsers fetch them directly.
    contentSecurityPolicy: false,
  })
);

// ── CORS — allow only known origins ───────────────────────────────────────────
const ALLOWED_ORIGINS = [
  /^https:\/\/(www\.)?msafirikenya\.com$/,
  /^https:\/\/.*\.msafirikenya\.com$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.repl\.co$/,
  /^http:\/\/localhost(:\d+)?$/,
];
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (native mobile, curl, server-to-server)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.some((re) => re.test(origin))) return cb(null, true);
      cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  })
);

// ── Global rate limiter ────────────────────────────────────────────────────────
// Broad DDoS baseline: 300 requests per 15 minutes per IP.
// Sensitive endpoints (auth, OTP, restore) have tighter per-route limiters.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  handler: (_req, res) => {
    res.set("Retry-After", "900");
    res.status(429).json({ error: "Too many requests. Please slow down." });
  },
});
app.use(globalLimiter);

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
// Inbound email webhook must receive the raw body for Svix signature verification —
// mount it BEFORE express.json() consumes the stream, using express.raw() for
// this path only.
app.use(
  "/api/webhooks/email-inbound",
  express.raw({ type: "application/json" }),
  inboundEmailRouter,
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Course-image PNGs rendered from the PDF — served directly (not under /api/
// because they are static assets, but proxied by the same domain).
app.use(
  "/api/course-images",
  express.static(path.join(__dirname, "../public/course-images"), {
    maxAge: "7d",
    immutable: true,
  })
);

// Branded clip short-links: msafirikenya.com/c/{token} → presigned R2 URL.
// Mounted BEFORE the /api router so it doesn't require the /api prefix.
app.use(clipRedirectRouter);

app.use("/api", router);

// ── Global Express error handler ───────────────────────────────────────────────
// Must be the *last* app.use() call so it catches errors from every route above.
// Express identifies error-handling middleware by its 4-argument signature.
// Any synchronous throw or next(err) call from any route lands here and is
// returned to the client as a JSON body — never as an empty 500 or HTML page.
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof (err as any)?.status === "number" ? (err as any).status : 500;
    const message =
      err instanceof Error
        ? err.message
        : typeof (err as any)?.message === "string"
          ? (err as any).message
          : "Internal server error";
    logger.error({ err }, "Unhandled route error");
    // Avoid sending headers twice if a partial response was already started.
    if (!res.headersSent) {
      res.status(status).json({ error: message });
    }
  }
);

export default app;
