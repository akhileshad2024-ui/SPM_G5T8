import { expect, test, type Page } from "@playwright/test";
import { action, MAYA, PRIYA, PASSWORD, workspaceStatus } from "./support/app";
import { singaporeTestDate } from "./support/dates";

test.use({ timezoneId: "Asia/Singapore" });

/** US16-TC01: numbered UI steps match the shared Sheet. No API fixture/reset.
 * Covers approved AC1/2/4, not the US36-dependent notification AC3.
 */
const NAME = "US16 Event Details Update Test";
const PURPOSE = "Prepare an introductory student conference.";
const REVISED = "Prepare an introductory conference for new students.";
const shared = process.env.TC_SHARED_DB === "1";

async function signIn(page: Page, email: string, landing: RegExp) {
  const password = shared ? process.env[email === MAYA.email ? "TC_MAYA_PASSWORD" : "TC_PRIYA_PASSWORD"] : PASSWORD;
  if (!password) throw new Error("Missing authorised TC password.");
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(email);
  await page.locator('input[type="password"]').fill(password);
  const loaded = page.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().method() === "GET");
  await action(page, "Sign in").click();
  await expect(page).toHaveURL(landing);
  const response = await loaded;
  expect(response.ok(), "The UI event-list request must succeed.").toBeTruthy();
  const events = await response.json();
  if (email === MAYA.email) await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount(events.length);
}

async function signOut(page: Page) {
  const done = page.waitForResponse((r) => r.url().includes("/api/auth/logout") && r.request().method() === "POST");
  await action(page, "Sign out").click();
  expect((await done).status()).toBe(204);
  await expect(page).toHaveURL(/\/login/);
}

function field(page: Page, label: string) {
  return page.locator("div.field").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}

async function queueEvent(page: Page, eventId: string) {
  await page.goto("/queue");
  await action(page, "All").click();
  await page.getByPlaceholder(/search events/i).fill(`EVT-${eventId}`);
  const row = page.locator('button[class*="QueueList"][class*="row"]').filter({ hasText: NAME });
  await expect(row).toHaveCount(1);
  await row.click();
}

test("[US16-TC01][AC1,AC2,AC4] assigned planning edit and important-change history", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const eventDate = singaporeTestDate(new Date());
  await testInfo.attach("test-date", { body: `EVENT_DATE=${eventDate.iso}; timezone=Asia/Singapore`, contentType: "text/plain" });
  // Steps 1–3: services started by executor/config; exact Maya login and baseline.
  await signIn(page, MAYA.email, /\/my-events/);
  const views = page.getByRole("link", { name: "View", exact: true });
  const before = await views.evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  await action(page, "New event request").click();

  // Steps 4–5: every written input/selection, no hidden fixture or direct API call.
  await page.getByPlaceholder("Alumni Homecoming Dinner").fill(NAME);
  await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
  await field(page, "Expected attendance").locator("input").fill("85");
  await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
  await field(page, "Proposed date").locator("input").fill(eventDate.iso);
  await field(page, "Start").locator("input").fill("18:00");
  await field(page, "End").locator("input").fill("21:00");
  await action(page, "Continue").click();
  await field(page, "Preferred venue location").locator("input").fill("");
  await field(page, "Required capacity").locator("input").fill("");
  const banquet = action(page, "Banquet");
  if (!(await banquet.getAttribute("class"))?.includes("chipOn")) await banquet.click();
  for (const [label, selected] of [["Facilities needed", "PA system"], ["Accessibility needs", "Wheelchair Access"]]) {
    for (const button of await field(page, label).getByRole("button").all()) {
      const wanted = (await button.innerText()) === selected;
      const on = (await button.getAttribute("class"))?.includes("chipOn") ?? false;
      if (wanted !== on) await button.click();
    }
  }
  await expect(page.locator('[class*="stepperValue"]')).toHaveText(["0", "0", "0", "0", "0"]);
  await expect(page.getByPlaceholder("Connections, setup, compatibility or power needs")).toHaveCount(0);
  await action(page, "Continue").click();

  // Steps 6–7: submit once and distinguish this run by its new ID.
  await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();
  await action(page, "Submit for review").click();
  await expect(page).toHaveURL(/\/my-events$/);
  await expect.poll(async () => (await views.evaluateAll((links) => links.map((a) => a.getAttribute("href"))))
    .filter((href) => !before.includes(href)).length).toBe(1);
  const href = (await views.evaluateAll((links) => links.map((a) => a.getAttribute("href"))))
    .find((value) => !before.includes(value))!;
  const eventId = href.split("/").pop()!;
  console.log(`US16-TC01 EVENT_ID=${eventId}`);
  await testInfo.attach("event-id", { body: `EVENT_ID=${eventId}; ${shared ? "shared DB" : "isolated CI regression"}`, contentType: "text/plain" });
  const eventRow = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(eventRow.locator(".pill")).toHaveText("Submitted");

  // Steps 8–11: UI login, assignment and review. Stop naturally if setup is unavailable.
  await signOut(page);
  await signIn(page, PRIYA.email, /\/queue/);
  await queueEvent(page, eventId);
  await page.getByLabel("Coordinator to assign").selectOption({ label: "Priya Tan (me)" });
  await action(page, "Assign").click();
  await expect(page.getByLabel("Coordinator to assign")).toHaveCount(0);
  await action(page, "Start review").click();
  await expect(workspaceStatus(page)).toHaveText("Under Review");

  // Steps 12–15: ordinary correction, one Save, then a persisted refresh check.
  await action(page, "Edit event details").click();
  const editor = page.getByRole("region", { name: "Edit event details", exact: true });
  await expect(editor.getByLabel("Purpose and description")).toHaveValue(PURPOSE);
  await expect(editor.getByLabel("Expected attendance")).toHaveValue("85");
  await expect(editor.getByLabel("Proposed date")).toHaveValue(eventDate.iso);
  await expect(editor.getByLabel("Start", { exact: true })).toHaveValue(/18:00/);
  await expect(editor.getByLabel("End", { exact: true })).toHaveValue(/21:00/);
  await expect(page.getByText("Not booked", { exact: true })).toBeVisible();
  await expect(page.getByText("None", { exact: true })).toBeVisible();
  await editor.getByLabel("Purpose and description").fill(REVISED);
  await expect(editor.getByRole("status")).toHaveText("Ordinary edit: no existing arrangements are recorded.");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Edit event details", exact: true })).toBeVisible();
  await expect(page.getByText(REVISED, { exact: true })).toBeVisible();
  await page.reload();
  await queueEvent(page, eventId);
  await expect(page.getByText(REVISED, { exact: true })).toBeVisible();
  await expect(workspaceStatus(page)).toHaveText("Under Review");
  await action(page, "Details").click();
  const savedDetails = page.getByRole("region", { name: "Event", exact: true });
  for (const [label, value] of [["Expected attendance", "85"], ["Date", eventDate.label], ["Time", "18:00 – 21:00"]]) {
    await expect(savedDetails.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  await action(page, "Hide details").click();

  // Steps 16–17: attendance is arrangement-sensitive; saving does not rebook.
  await action(page, "Edit event details").click();
  await expect(editor.getByLabel("Expected attendance")).toHaveValue("85");
  await expect(editor.getByLabel("Proposed date")).toHaveValue(eventDate.iso);
  await expect(editor.getByLabel("Start", { exact: true })).toHaveValue(/18:00/);
  await expect(editor.getByLabel("End", { exact: true })).toHaveValue(/21:00/);
  await editor.getByLabel("Expected attendance").fill("90");
  await expect(editor.getByRole("status")).toContainText("May affect existing arrangements.");
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Edit event details", exact: true })).toBeVisible();
  await expect(page.locator('[class*="EventWorkspace"][class*="line"]').first()).toContainText("90");

  // Steps 18–19: saved history survives refresh with the same actor/time/value.
  await action(page, "Activity").click();
  const history = page.getByRole("region", { name: "Event detail changes", exact: true });
  await expect(history).toContainText("Expected attendance: 90");
  await expect(history).toContainText("Priya Tan");
  await expect(history).toContainText("May affect existing arrangements.");
  const timestamp = await history.locator("time").getAttribute("datetime");
  expect(timestamp).toBeTruthy();
  await page.reload();
  await queueEvent(page, eventId);
  await action(page, "Activity").click();
  await expect(history).toContainText("Expected attendance: 90");
  await expect(history).toContainText("Priya Tan");
  await expect(history.locator("time")).toHaveAttribute("datetime", timestamp!);

  // Steps 20–22: organiser sees persisted details but has no direct editor.
  await signOut(page);
  await signIn(page, MAYA.email, /\/my-events/);
  await page.locator(`a[href="${href}"]`).click();
  await expect(page.getByText(REVISED, { exact: true })).toBeVisible();
  const details = page.getByRole("region", { name: "Event", exact: true });
  for (const [label, value] of [["Expected attendance", "90"], ["Date", eventDate.label], ["Time", "18:00 – 21:00"]]) {
    await expect(details.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  await expect(page.getByRole("region", { name: "Edit event details", exact: true })).toHaveCount(0);
  await expect(page.locator('input:not([type="hidden"]), select, textarea')).toHaveCount(0);
  await signOut(page);
  // Executor appends the actual yellow record after the complete matching run.
});
