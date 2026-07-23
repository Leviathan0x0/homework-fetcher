const { defineConfig } = require("drizzle-kit");

module.exports = defineConfig({
  dialect: "sqlite",
  schema: "./server/db/schema.js",
  out: "./server/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL || "./sqlite.db"
  }
});
