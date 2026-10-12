import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js preserves JSX for its own compiler; coverage needs executable JS instead.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.unit.test.ts"],
    coverage: {
      provider: "v8",
      // Include untested pages/components/context, not just the already-tested helpers.
      include: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
      reporter: ["text", "html", "json-summary", "lcov"],
      reportOnFailure: true,
      reportsDirectory: "coverage/frontend", // per-story CLI runs may override this path
    },
  },
});
