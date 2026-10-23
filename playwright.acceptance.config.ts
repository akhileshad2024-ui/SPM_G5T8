import { defineConfig, devices } from "@playwright/test";

/** Explicit opt-in: written TC against the existing app/database.
 * No seed/reset script or DATABASE_URL override. Not used by normal CI.
 * Start `npm run dev:all` first; provide TC passwords to this process only.
 */
if (process.env.TC_SHARED_DB !== "1") throw new Error("Set TC_SHARED_DB=1 to acknowledge shared event writes.");
for (const key of ["TC_MAYA_PASSWORD", "TC_PRIYA_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}; use the authorised TC credentials.`);
}

export default defineConfig({
  testDir: "tests/functional",
  testMatch: process.env.TC_STORY === "US16" ? "us16-update-event-details.spec.ts" : "us09-respond-clarification.spec.ts",
  grep: process.env.TC_STORY === "US16" ? /US16-TC01/ : /US09-TC01/,
  workers: 1,
  retries: 0, // Do not automatically repeat shared-data writes.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "coverage/acceptance/report", open: "never" }]],
  outputDir: "coverage/acceptance/results",
  use: {
    baseURL: "http://localhost:3000",
    timezoneId: "Asia/Singapore",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
