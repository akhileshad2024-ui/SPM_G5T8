import { expect, test, type Page } from "@playwright/test";
import { action, GRACE, MAYA, PRIYA, PASSWORD, submitDialog, workspaceStatus } from "./support/app";
import { singaporeTestDate } from "./support/dates";

test.use({ timezoneId: "Asia/Singapore" });

/** Numbered UI workflow matches the shared US09-TC01. No API fixture or reset.
 * Acceptance config uses the existing DB and written TC passwords. Normal CI
 * runs the same UI with isolated passwords; it is not a shared-environment run.
 */
const NAME = "US09 Clarification Response Test";
const PURPOSE = "Verify an organiser response is retained for coordinator review.";
const QUESTION = "Please confirm whether the 85 attendees include speakers.";
const RESPONSE = "Yes, the total of 85 includes 5 speakers.";
const shared = process.env.TC_SHARED_DB === "1";

async function signIn(page: Page, who: typeof MAYA, landing: RegExp) {
  const password = shared
    ? process.env[who.email === MAYA.email ? "TC_MAYA_PASSWORD" : who.email === GRACE.email ? "TC_GRACE_PASSWORD" : "TC_PRIYA_PASSWORD"]
    : PASSWORD;
  if (!password) throw new Error("The authorised TC password is missing.");
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(who.email);
  await page.locator('input[type="password"]').fill(password);
  const loaded = page.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().method() === "GET");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(landing);
  const response = await loaded;
  expect(response.ok(), `The UI event-list request failed (${response.status()}); TC setup is blocked.`).toBeTruthy();
  const events = await response.json();
  // The heading appears before async data. Wait for actual rows before capturing
  // the baseline, otherwise existing records can be mistaken for newly created ones.
  if (who.email === MAYA.email) await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount(events.length);
}

async function signOut(page: Page) {
  // The UI navigates immediately. Wait for its logout request before the next
  // navigation, otherwise the old cookie can redirect the login page back.
  const loggedOut = page.waitForResponse((r) => r.url().includes("/api/auth/logout") && r.request().method() === "POST");
  await action(page, "Sign out").click();
  expect((await loggedOut).status()).toBe(204);
  await expect(page).toHaveURL(/\/login/);
}

// Existing visible labels are not associated with input IDs. Scope by their field.
function field(page: Page, label: string) {
  return page.locator("div.field").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}

async function openQueueEvent(page: Page, eventId: string) {
  await page.goto("/queue");
  await action(page, "All").click();
  await page.getByPlaceholder(/search events/i).fill(`EVT-${eventId}`);
  const row = page.locator('button[class*="QueueList"][class*="row"]').filter({ hasText: NAME });
  await expect(row).toHaveCount(1);
  await row.click();
}

async function unchangedDetails(page: Page, eventDateLabel: string) {
  const event = page.getByRole("region", { name: "Event", exact: true });
  for (const [label, value] of [["Expected attendance", "85"], ["Date", eventDateLabel], ["Time", "18:00 – 21:00"]]) {
    await expect(event.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
      .locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
}

for (const kind of ["clarification", "amendment"] as const) {
  const id = kind === "clarification" ? "US09-TC01" : "US09-REGRESSION";
  test(`[${id}][AC1–AC3] complete ${kind} response workflow`, async ({ page }, testInfo) => {
    const eventDate = singaporeTestDate(new Date());
    await testInfo.attach("test-date", { body: `EVENT_DATE=${eventDate.iso}; timezone=Asia/Singapore`, contentType: "text/plain" });
    // Steps 1–4: app started as a precondition; log in and capture existing IDs.
    await signIn(page, MAYA, /\/my-events/);
    const views = page.getByRole("link", { name: "View", exact: true });
    await expect(page.getByText("My event requests", { exact: true })).toBeVisible();
    const before = await views.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    await action(page, "New event request").click();
    await expect(page).toHaveURL(/\/new-request/);

    // Step 5: written inputs; EVENT_DATE is captured once at workflow start.
    await page.getByPlaceholder("Alumni Homecoming Dinner").fill(NAME);
    await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
    await field(page, "Expected attendance").locator("input").fill("85");
    await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
    await field(page, "Proposed date").locator("input").fill(eventDate.iso);
    await field(page, "Start").locator("input").fill("18:00");
    await field(page, "End").locator("input").fill("21:00");
    await action(page, "Continue").click();

    // Step 6: explicitly match the selected facilities/accessibility and zero equipment.
    await field(page, "Preferred venue location").locator("input").fill("");
    await field(page, "Required capacity").locator("input").fill("");
    await action(page, "Banquet").click();
    for (const [label, selected] of [["Facilities needed", "PA system"], ["Accessibility needs", "Wheelchair Access"]]) {
      for (const button of await field(page, label).getByRole("button").all()) {
        const wanted = (await button.innerText()) === selected;
        const on = (await button.getAttribute("class"))?.includes("chipOn") ?? false;
        if (on !== wanted) await button.click();
      }
    }
    await expect(page.locator('[class*="stepperValue"]')).toHaveText(["0", "0", "0", "0", "0"]);
    await expect(page.getByPlaceholder("Connections, setup, compatibility or power needs")).toHaveCount(0);
    await action(page, "Continue").click();

    // Steps 7–8: submit once, capture the single new browser-visible ID.
    await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();
    await action(page, "Submit for review").click();
    await expect(page).toHaveURL(/\/my-events$/);
    await expect.poll(async () => (await views.evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
      .filter((href) => !before.includes(href)).length).toBe(1);
    const after = await views.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const href = after.find((value) => !before.includes(value))!;
    const eventId = href.split("/").pop()!;
    const eventRow = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
    await expect(eventRow.locator(".pill")).toHaveText("Submitted");
    console.log(`${id} EVENT_ID=${eventId}`);
    await testInfo.attach("event-id", { body: `EVENT_ID=${eventId}\nEnvironment=${shared ? "existing shared DB" : "isolated CI regression"}`, contentType: "text/plain" });

    // Steps 9–12: the Lead assigns Priya (US43), then Priya starts the review and asks the question through the UI.
    await signOut(page);
    await signIn(page, GRACE, /\/assignments/);
    const request = page.locator('[aria-label^="Unassigned request:"]').filter({ hasText: `EVT-${eventId}` });
    await request.getByLabel("Coordinator to assign").selectOption({ label: PRIYA.name });
    await request.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(request).toHaveCount(0);
    await signOut(page);
    await signIn(page, PRIYA, /\/queue/);
    await openQueueEvent(page, eventId);
    await expect(action(page, "Start review")).toBeVisible();
    await action(page, "Start review").click();
    await expect(workspaceStatus(page)).toHaveText("Under Review");
    await action(page, kind === "clarification" ? "Request clarification" : "Request amendment").click();
    await submitDialog(page, QUESTION, "Send request");
    await expect(workspaceStatus(page)).toHaveText("Pending Clarification");
    const thread = page.getByRole("region", { name: "Clarification conversation" });
    await expect(thread).toContainText(QUESTION);

    // Steps 13–17: organiser views, replies once, checks read-only details and reloads.
    await signOut(page);
    await signIn(page, MAYA, /\/my-events/);
    await page.locator(`a[href="${href}"]`).click();
    await expect(thread.getByText(`${PRIYA.name}: ${QUESTION}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: NAME, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "People", exact: true })).toContainText("Maya Rahman");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(page.locator('input:not([type="hidden"]), select')).toHaveCount(0);
    await page.getByLabel("Response", { exact: true }).fill(RESPONSE);
    await action(page, "Send response").click();
    await expect(thread.getByText(`${PRIYA.name}: ${QUESTION}`, { exact: true })).toBeVisible();
    await expect(thread.getByText(`${MAYA.name}: ${RESPONSE}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: NAME, exact: true })).toBeVisible();
    await expect(page.locator(".pill").first()).toHaveText("Pending Clarification");
    await unchangedDetails(page, eventDate.label);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(thread).toContainText(QUESTION);
    await expect(thread).toContainText(RESPONSE);

    // Steps 18–20: new logins and the same ID, never an earlier identical event name.
    await signOut(page);
    await signIn(page, MAYA, /\/my-events/);
    await expect(views).toHaveCount(before.length + 1);
    await page.locator(`a[href="${href}"]`).click();
    await expect(thread).toContainText(RESPONSE);
    await signOut(page);
    await signIn(page, PRIYA, /\/queue/);
    await openQueueEvent(page, eventId);
    await action(page, "Request").click();
    await expect(thread.getByText(`${PRIYA.name}: ${QUESTION}`, { exact: true })).toBeVisible();
    await expect(thread.getByText(`${MAYA.name}: ${RESPONSE}`, { exact: true })).toBeVisible();

    // Steps 21–23: explicit resume, unchanged details, sign out; no approval/rejection.
    await action(page, "Resume review").click();
    await expect(workspaceStatus(page)).toHaveText("Under Review");
    await expect(action(page, "Approve")).toBeVisible();
    await expect(action(page, "Reject")).toBeVisible();
    await action(page, "Details").click();
    await unchangedDetails(page, eventDate.label);
    await signOut(page);
  });
}
