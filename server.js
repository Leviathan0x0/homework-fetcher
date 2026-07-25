const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const authRoutes = require("./server/routes/authRoutes");
const homeworkRoutes = require("./server/routes/homeworkRoutes");
const classworkRoutes = require("./server/routes/classworkRoutes");
const requestsRoutes = require("./server/routes/requestsRoutes");
const messagingRoutes = require("./server/routes/messagingRoutes");
const notificationsRoutes = require("./server/routes/notificationsRoutes");
const { allowedOrigins, isAllowedOrigin } = require("./server/config");
const { ready } = require("./server/db/client");

const app = express();

// Required so Secure cookies are honoured behind hosting platform TLS proxies
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Allow a separately hosted frontend (e.g. Appwrite Sites) to call this API with cookies
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  } else if (origin && allowedOrigins.length && req.path.startsWith("/api")) {
    console.warn(`Blocked cross-origin API request from ${origin}. Add it to ALLOWED_ORIGINS to allow it.`);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// The schema is created/migrated once per process; API requests wait for it so
// the first query never races the migrations.
app.use("/api", (req, res, next) => {
  ready.then(() => next()).catch((err) => {
    console.error("Database unavailable:", err);
    res.status(503).json({ error: "Database unavailable. Check the database configuration." });
  });
});

// Mount API routes
app.use("/api/auth", authRoutes);
app.use("/api", homeworkRoutes);
app.use("/api", classworkRoutes);
app.use("/api", requestsRoutes);
app.use("/api", messagingRoutes);
app.use("/api", notificationsRoutes);

// Serve built Vite assets from dist/ if present, fallback to public/
app.use(express.static(path.join(__dirname, "dist")));
app.use(express.static(path.join(__dirname, "public")));

// Unknown API routes must not fall through to the SPA HTML response
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Unknown API endpoint: ${req.method} /api${req.path}` });
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
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Homework Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
