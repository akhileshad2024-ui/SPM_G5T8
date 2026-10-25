import { defineConfig, devices } from "@playwright/test";

/** Explicit opt-in: written TC against the existing app/database.
 * No seed/reset script or DATABASE_URL override. Not used by normal CI.
 * Start `npm run dev:all` first; provide TC passwords to this process only.
 */
if (process.env.TC_SHARED_DB !== "1") throw new Error("Set TC_SHARED_DB=1 to acknowledge shared event writes.");
const story = process.env.TC_STORY ?? "US09";
if (!["US04", "US06", "US09", "US16", "US33", "US34"].includes(story)) throw new Error("TC_STORY must be US04, US06, US09, US16, US33 or US34.");
for (const key of story === "US04" ? ["TC_MAYA_PASSWORD", "TC_JORDAN_PASSWORD"] : story === "US33" ? ["TC_MAYA_PASSWORD"] : story === "US06"
  ? ["TC_MAYA_PASSWORD", "TC_ALEX_PASSWORD"] : ["TC_MAYA_PASSWORD", "TC_PRIYA_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}; use the authorised TC credentials.`);
}

export default defineConfig({
  testDir: "tests/functional",
  testMatch: story === "US04" ? "us04-submit-to-lead-queue.spec.ts" : story === "US06" ? "us06-draft-ownership.spec.ts" : story === "US34" ? "us34-review-event-changes.spec.ts" : story === "US33" ? "us33-request-event-changes.spec.ts"
    : story === "US16" ? "us16-update-event-details.spec.ts" : "us09-respond-clarification.spec.ts",
  grep: new RegExp(story === "US04" ? "US04-TC03" : story === "US06" ? "US06-TC02" : story === "US34" ? "US34-TC0[12]" : `${story}-TC01`),
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
