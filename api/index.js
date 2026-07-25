/**
 * Vercel entry point: every /api/* request is handled by the Express app so the
 * real, database-backed API is the single source of truth in production.
 */
module.exports = require("../server.js");
