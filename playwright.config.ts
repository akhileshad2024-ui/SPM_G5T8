import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Functional (end-to-end) tests: a real browser drives the real app.
 *
 * Playwright starts both servers itself, on their own ports so they don't clash
 * with `npm run dev`:
 *   - FastAPI on a throwaway SQLite database, seeded with test accounts (never Supabase)
 *   - Next.js, proxying /api to that backend
 *
 *   npm run test:functional            (set PYTHON if `python` isn't the backend's interpreter)
 */
const BACKEND_PORT = 8100;
const FRONTEND_PORT = 3100;
const python = process.env.PYTHON ?? "python";
const database = path.join(os.tmpdir(), "connectsphere-functional", "functional.db").replace(/\\/g, "/");

export default defineConfig({
  testDir: "tests/functional",
  testMatch: "**/*.spec.ts",
  // The tests share one database and one coordinator, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "coverage/functional/report", open: "never" }]],
  outputDir: "coverage/functional/results",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `${python} ../tests/functional/support/seed_users.py && ${python} -m uvicorn main:app --port ${BACKEND_PORT}`,
      cwd: "backend",
      url: `http://127.0.0.1:${BACKEND_PORT}/docs`,
      env: {
        DATABASE_URL: `sqlite:///${database}`,
        JWT_SECRET: "functional-tests-only-secret-0123456789abcdef",
        APP_ENV: "development",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next dev --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}/login`,
      env: { BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
