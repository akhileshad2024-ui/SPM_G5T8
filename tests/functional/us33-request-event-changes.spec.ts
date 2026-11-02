import { expect, test, type Page } from "@playwright/test";
import { action, JORDAN, MAYA, PRIYA, PASSWORD } from "./support/app";
import { singaporeTestDate } from "./support/dates";

/** US33-TC01: same UI preparation, input and checkpoints as the written TC.
 * CI uses isolated fixture credentials; shared acceptance is a separate opt-in.
 */
const NAME = "US33 Event Change Request Test";
const PURPOSE = "Verify a proposed change is saved without changing the event.";
const PROPOSAL = "Increase expected attendance from 85 to 90.";
const shared = process.env.TC_SHARED_DB === "1";
// Match the campus date used by the backend and the manual TC, on any machine.
test.use({ timezoneId: "Asia/Singapore" });

function field(page: Page, label: string) {
  return page.locator("div.field").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}

async function login(page: Page, person = MAYA, landing = /\/my-events$/) {
  const password = shared
    ? process.env[person.email === MAYA.email ? "TC_MAYA_PASSWORD" : person.email === JORDAN.email ? "TC_JORDAN_PASSWORD" : "TC_PRIYA_PASSWORD"]
    : PASSWORD;
  if (!password) throw new Error("Missing authorised TC password.");
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(person.email);
  await page.locator('input[type="password"]').fill(password);
  const loaded = page.waitForResponse(r => r.url().endsWith("/api/events") && r.request().method() === "GET");
  await action(page, "Sign in").click();
  await expect(page).toHaveURL(landing);
  const response = await loaded;
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  if (person.email === MAYA.email) await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount(saved.length);
}

async function logout(page: Page) {
  const done = page.waitForResponse(r => r.url().includes("/api/auth/logout") && r.request().method() === "POST");
  await action(page, "Sign out").click();
  expect((await done).status()).toBe(204);
  await expect(page).toHaveURL(/\/login/);
}

test("[US33-TC01][AC1–AC3] persist a proposal and notify its coordinator without editing the event", async ({ page }, info) => {
  test.setTimeout(120_000);
  // Capture once: every input and check in this run uses the same Singapore day.
  const startedAt = new Date();
  const date = singaporeTestDate(startedAt);
  const eventDate = date.iso;
  const expectedDate = date.label;
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(startedAt);
  const tag = `${eventDate} ${clock}.${String(startedAt.getMilliseconds()).padStart(3, "0")}`;
  const name = `${NAME} ${tag}`;
  await info.attach("test-data", { body: `EVENT_DATE=${eventDate}; RUN_TAG=${tag}; EVENT_NAME=${name}; timezone=Asia/Singapore`, contentType: "text/plain" });
  // Steps 1–4: services are a precondition; login and capture the loaded baseline.
  await login(page);
  const views = page.getByRole("link", { name: "View", exact: true });
  const before = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
  await action(page, "New event request").click();

  // Steps 5–7: all written inputs are explicit; no API-created fixture.
  await page.getByPlaceholder("Alumni Homecoming Dinner").fill(name);
  await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
  await field(page, "Expected attendance").locator("input").fill("85");
  await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
  await field(page, "Proposed date").locator("input").fill(eventDate);
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
      if (on !== wanted) await button.click();
    }
  }
  const quantities = page.locator('[class*="stepperValue"]');
  expect(await quantities.count()).toBeGreaterThan(0);
  for (const quantity of await quantities.all()) await expect(quantity).toHaveText("0");
  await expect(page.getByPlaceholder("Connections, setup, compatibility or power needs")).toHaveCount(0);
  await action(page, "Continue").click();
  await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();
  expect(singaporeTestDate(new Date()).iso, "Restart if midnight crossed before submission.").toBe(eventDate);
  await action(page, "Submit for review").click();

  // Step 8: capture this run's event, rather than a previous same-named record.
  await expect(page).toHaveURL(/\/my-events$/);
  await expect(views).toHaveCount(before.length + 1);
  const after = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
  const href = after.find(value => !before.includes(value))!;
  expect(href).toBeTruthy();
  const eventId = href.split("/").pop()!;
  const row = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(row).toContainText(name);
  await expect(row.locator(".pill")).toHaveText("Submitted");

  // Steps 9–10: assign before the proposal so there is a responsible recipient.
  await logout(page);
  await login(page, JORDAN, /\/assignments/);
  const unassigned = page.getByRole("region", { name: "Unassigned requests", exact: true })
    .locator('[aria-label^="Unassigned request:"]').filter({ hasText: `EVT-${eventId} ·` });
  await expect(unassigned).toContainText(name);
  await unassigned.getByLabel("Coordinator to assign").selectOption({ label: PRIYA.name });
  await unassigned.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(unassigned).toHaveCount(0);
  await logout(page);
  await login(page);

  // Steps 11–12: submit the exact written proposal once, through the UI.
  await row.getByRole("button", { name: "Request change", exact: true }).click();
  await expect(page.getByText("Request a change", { exact: true })).toBeVisible();
  await page.locator("textarea.textarea-input").fill(PROPOSAL);
  await action(page, "Submit change request").click();
  await expect(page.getByText("Change request submitted.", { exact: true })).toBeVisible();
  await expect(page.locator("textarea.textarea-input")).toHaveCount(0);
  await page.locator(`a[href="${href}"]`).click();

  // Steps 13–15: one persisted request, unchanged event, same IDs after refresh.
  const proposals = page.getByRole("region", { name: "Change requests", exact: true });
  await expect(proposals.getByRole("listitem")).toHaveCount(1);
  await expect(proposals).toContainText(PROPOSAL);
  await expect(proposals).toContainText("Awaiting coordinator review");
  const requestLabel = (await proposals.getByRole("listitem").innerText()).match(/Request #(\d+)/)![0];
  async function unchanged() {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.locator(".pill").first()).toHaveText("Submitted");
    const details = page.getByRole("region", { name: "Event", exact: true });
    for (const [label, value] of [["Expected attendance", "85"], ["Date", expectedDate], ["Time", "18:00 – 21:00"]]) {
      await expect(details.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::dd[1]")).toHaveText(value);
    }
    await expect(page.getByText(PURPOSE, { exact: true })).toBeVisible();
    await expect(page.locator("input, select, textarea")).toHaveCount(0);
  }
  await unchanged();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(proposals).toContainText(requestLabel);
  await expect(proposals).toContainText(PROPOSAL);
  await unchanged();

  // Steps 16–17: new organiser session, same proposal and no additional event.
  await logout(page);
  await login(page);
  await expect(views).toHaveCount(before.length + 1);
  await page.locator(`a[href="${href}"]`).click();
  await expect(proposals).toContainText(requestLabel);
  await expect(proposals).toContainText(PROPOSAL);
  await expect(proposals).toContainText("Awaiting coordinator review");
  await unchanged();

  // Steps 18–19: the assigned coordinator gets the proposal, not an applied edit.
  await logout(page);
  await login(page, PRIYA, /\/queue/);
  const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: name })
    .filter({ hasText: "Change requested" });
  async function checkNotice() {
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText(PROPOSAL);
  }
  async function openRequest() {
    await notice.getByRole("button", { name: "Open event", exact: true }).click();
    await expect(page).toHaveURL(/\/queue$/);
    const workspace = page.locator('[class*="EventWorkspace"][class*="headerMain"]');
    await expect(workspace).toContainText(name);
    await expect(proposals).toContainText(requestLabel);
    await expect(proposals).toContainText(PROPOSAL);
    await expect(proposals).toContainText("Awaiting coordinator review");
    await expect(workspace).toContainText(`EVT-${eventId}`);
    await expect(workspace.locator(".pill")).toHaveText("Submitted");
    await expect(page.getByRole("region", { name: "Existing arrangements", exact: true }))
      .toContainText(`Event: ${expectedDate}, 18:00–21:00; expected attendance 85.`);
  }
  await checkNotice();
  await openRequest();

  // Steps 20–22: saved notice survives refresh and a new coordinator session.
  await page.reload();
  await checkNotice();
  await logout(page);
  await login(page, PRIYA, /\/queue/);
  await checkNotice();
  await openRequest();
  await logout(page);
  const record = `EVENT_DATE=${eventDate}; EVENT_NAME=${name}; EVENT_ID=${eventId}; ${requestLabel}; coordinator=${PRIYA.name}; notification persisted; count=${before.length}->${before.length + 1}; ${shared ? "shared acceptance" : "isolated regression"}`;
  console.log(`US33-TC01 ${record}`);
  await info.attach("record-ids", { body: record, contentType: "text/plain" });
});
