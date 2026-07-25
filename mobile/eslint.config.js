const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*"],
  },
  {
    rules: {
      // The quality bar for this app forbids `any` in application code.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);
