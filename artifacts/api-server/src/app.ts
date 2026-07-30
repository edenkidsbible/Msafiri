import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

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
