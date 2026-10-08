import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.unit.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage", // per-story reports: python run_coverage.py usXX
    },
  },
});
