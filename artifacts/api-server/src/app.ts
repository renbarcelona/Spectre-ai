import express, { type Express } from "express";
import path from "node:path";
import { pool } from "@workspace/db";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

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
app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.get("/api/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.set("Cache-Control","no-store").json({ready:true});
  } catch { res.status(503).json({ready:false}); }
});
app.use(["/api/login", "/api/logout"], (_req,res) => {
  res.status(410).json({error:"Use the local team sign-in and logout endpoints."});
});
app.use("/api", router);
app.use("/api", (_req,res) => {res.status(404).json({error:"Not found"});});
const staticDir = path.resolve(process.env.STATIC_DIR || "artifacts/sentinel/dist/public");
app.use(express.static(staticDir));
app.get("/{*splat}", (req,res) => {
  if (path.extname(req.path)) {res.sendStatus(404);return;}
  res.set("Cache-Control","no-store").sendFile(path.join(staticDir,"index.html"));
});

export default app;
