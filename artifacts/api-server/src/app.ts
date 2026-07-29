import express, { type Express } from "express";
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

export default app;
