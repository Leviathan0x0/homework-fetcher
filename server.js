const express = require("express");
const path = require("path");

// Load .env variables into process.env if present
try {
  const fs = require("fs");
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, "utf8");
    envConfig.split("\n").forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = (match[2] || "").trim().replace(/^['"]|['"]$/g, "");
      }
    });
  }
} catch (e) {}

const { setupExpressErrorHandler } = require("./server/sentry");

const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const authRoutes = require("./server/routes/authRoutes");
const homeworkRoutes = require("./server/routes/homeworkRoutes");
const classworkRoutes = require("./server/routes/classworkRoutes");
const requestsRoutes = require("./server/routes/requestsRoutes");
const messagingRoutes = require("./server/routes/messagingRoutes");
const notificationsRoutes = require("./server/routes/notificationsRoutes");
const calendarRoutes = require("./server/routes/calendarRoutes");
const adminRoutes = require("./server/routes/adminRoutes");
const teacherRoutes = require("./server/routes/teacherRoutes");
const { allowedOrigins, isAllowedOrigin } = require("./server/config");
const { isConfigured, MISSING_KEY_MESSAGE } = require("./server/auth/secrets");
const { isTestTeacherEnabled } = require("./server/teacher/teacherService");
const { ensureDatabaseReady, isRemote, db, schema } = require("./server/db/client");
const { rateLimit } = require("./server/limits");

const app = express();
const sentryBrowserEnabled = process.env.SENTRY_BROWSER_ENABLED === "true";
const corsRequestHeaders = [
  "Content-Type",
  "Accept",
  "Authorization",
  ...(sentryBrowserEnabled ? ["baggage", "sentry-trace"] : []),
].join(", ");

/**
 * Gzips JSON responses that are large enough to be worth it.
 *
 * Only res.json is wrapped, so file downloads and streamed responses keep their
 * existing handling.
 */
function compressJsonResponses({ threshold = 1024 } = {}) {
  const zlib = require("zlib");

  return function compressJson(req, res, next) {
    const acceptsGzip = /\bgzip\b/i.test(req.headers["accept-encoding"] || "");
    if (!acceptsGzip || req.method === "HEAD") return next();

    const sendJson = res.json.bind(res);
    res.json = (body) => {
      let payload;
      try {
        payload = Buffer.from(JSON.stringify(body === undefined ? null : body));
      } catch {
        return sendJson(body);
      }

      if (payload.length < threshold || res.getHeader("Content-Encoding")) {
        return sendJson(body);
      }

      let compressed;
      try {
        compressed = zlib.gzipSync(payload);
      } catch (err) {
        console.error("Response compression failed:", err.message);
        return sendJson(body);
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(compressed.length));
      res.setHeader("Vary", res.getHeader("Vary") ? `${res.getHeader("Vary")}, Accept-Encoding` : "Accept-Encoding");
      return res.end(compressed);
    };

    next();
  };
}

// Required so Secure cookies are honoured behind hosting platform TLS proxies
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Allow a separately hosted frontend (e.g. Appwrite Sites, Expo Web) to call this API with cookies
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", corsRequestHeaders);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  } else if (req.method === "OPTIONS" && req.path.startsWith("/api")) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", corsRequestHeaders);
    return res.sendStatus(204);
  } else if (origin && allowedOrigins.length && req.path.startsWith("/api")) {
    console.warn(`Blocked cross-origin API request from ${origin}. Add it to ALLOWED_ORIGINS to allow it.`);
  }
  next();
});

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));
app.use(cookieParser());

// API payloads are JSON lists (messages, homework, rosters) that compress by
// roughly an order of magnitude. On a phone connection the transfer, not the
// query, is what makes a screen feel slow.
app.use("/api", compressJsonResponses());

// Without a real signing/encryption key, session cookies could be forged by
// anyone, so the API refuses to answer instead of running insecurely.
app.use("/api", (req, res, next) => {
  if (isConfigured() || req.path === "/health") return next();
  console.error(`[auth] ${MISSING_KEY_MESSAGE}`);
  res.status(503).json({ error: "Server is not configured correctly. Please try again later." });
});

// Guard against runaway clients and accidental polling loops. Counters are
// per-instance, so this is a safety net rather than a hard quota.
app.use("/api", rateLimit({ name: "api", windowMs: 60 * 1000, max: 600 }));

// The schema is created/migrated once per process; API requests wait for it so
// the first query never races the migrations.
app.use("/api", (req, res, next) => {
  // Health must remain reachable when database startup is the failure being
  // diagnosed; the route below reports that failure without exposing secrets.
  if (req.path === "/health") return next();
  ensureDatabaseReady().then(() => next()).catch((err) => {
    console.error("Database unavailable:", err.message);
    res.status(503).json({
      error: err?.message || "Database unavailable. Check the database configuration.",
    });
  });
});

// GET /api/health — configuration diagnostics (no secrets), useful to check a deployment
app.get("/api/health", async (req, res) => {
  const status = {
    ok: true,
    database: isRemote ? "hosted (libSQL)" : "local SQLite file",
    persistent: isRemote || !process.env.VERCEL,
    encryptionKeyConfigured: isConfigured(),
    uploadsDirConfigured: !!process.env.UPLOADS_DIR,
    testTeacherEnabled: isTestTeacherEnabled(),
  };

  if (!status.encryptionKeyConfigured) {
    status.ok = false;
    status.error = MISSING_KEY_MESSAGE;
  }

  try {
    await ensureDatabaseReady();
    await db.select().from(schema.users).limit(1).all();
  } catch (err) {
    status.ok = false;
    status.error = err.message;
  }

  if (!status.persistent) {
    status.warning =
      "Data is stored on a temporary filesystem and is lost between requests and deploys. " +
      "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. See DEPLOYMENT.md.";
  }

  return res.status(status.ok ? 200 : 503).json(status);
});

// Mount API routes
app.use("/api/auth", authRoutes);
app.use("/api", homeworkRoutes);
app.use("/api", classworkRoutes);
app.use("/api", requestsRoutes);
app.use("/api", messagingRoutes);
app.use("/api", notificationsRoutes);
app.use("/api", calendarRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/teacher", teacherRoutes);

// Serve built Vite assets from dist/ if present, fallback to public/
// Vite fingerprints everything under /assets, so those files can be cached
// permanently; the rest is revalidated so a deploy is picked up immediately.
app.use(
  express.static(path.join(__dirname, "dist"), {
    maxAge: "1y",
    setHeaders: (res, filePath) => {
      if (!filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// Unknown API routes must not fall through to the SPA HTML response
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Unknown API endpoint: ${req.method} /api${req.path}` });
});

setupExpressErrorHandler(app);

// Surface API failures as JSON instead of an opaque platform error page
app.use("/api", (err, req, res, next) => {
  console.error(`API error on ${req.method} /api${req.path}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err?.message || "Unexpected server error." });
});

// Fallback SPA routing to index.html (Express 5 compatible catch-all)
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const distHtml = path.join(__dirname, "dist", "index.html");
  res.sendFile(distHtml, (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, "public", "index.html"), () => res.status(404).end());
    }
  });
});

// Express Global Error Handler (catches any unhandled route exceptions)
app.use((err, req, res, next) => {
  console.error("EXPRESS UNCAUGHT ROUTE ERROR:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    authenticated: false,
    error: err.message || "An unexpected server error occurred."
  });
});

if (require.main === module) {
  if (!isConfigured()) {
    console.error(`[auth] ${MISSING_KEY_MESSAGE}`);
    process.exit(1);
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Homework Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
