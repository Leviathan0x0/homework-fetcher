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

const app = express();

app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

// Fallback SPA routing to index.html (Express 5 compatible catch-all)
app.use((req, res) => {
  const distHtml = path.join(__dirname, "dist", "index.html");
  res.sendFile(distHtml, (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, "public", "index.html"));
    }
  });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Homework Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
