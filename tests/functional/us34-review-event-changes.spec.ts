import { expect, test, type Page } from "@playwright/test";
import { action, apiAs, JORDAN, MAYA, PRIYA, PASSWORD } from "./support/app";
import { singaporeTestDate } from "./support/dates";
import { seedScenario } from "./support/scenario";

/** TC01/TC02 mirror the written UI procedure; no API fixture replaces its steps. */
const NAME = "US34 Change Decision Test";
const PURPOSE = "Verify coordinator review keeps the event unchanged.";
const PROPOSAL = "Increase expected attendance from 85 to 90.";
const shared = process.env.TC_SHARED_DB === "1";
test.use({ timezoneId: "Asia/Singapore" });

function field(page: Page, label: string) {
  return page.locator("div.field").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}

async function login(page: Page, person: typeof MAYA, landing: RegExp) {
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
  const events = await response.json();
  if (person.email === MAYA.email) await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount(events.length);
}

async function logout(page: Page) {
  const done = page.waitForResponse(r => r.url().includes("/api/auth/logout") && r.request().method() === "POST");
  await action(page, "Sign out").click();
  expect((await done).status()).toBe(204);
  await expect(page).toHaveURL(/\/login/);
}

async function queueEvent(page: Page, eventId: string, name = NAME) {
  await page.goto("/queue");
  await action(page, "All").click();
  await page.getByPlaceholder(/search events/i).fill(`EVT-${eventId}`);
  const row = page.locator('button[class*="QueueList"][class*="row"]').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.click();
}

for (const [id, outcome, decisionButton] of [
  ["US34-TC01", "accepted", "Accept change request"],
  ["US34-TC02", "rejected", "Reject change request"],
] as const) {
  test(`[${id}][US34-AC1–AC5] ${outcome} decision persists and notifies the organiser`, async ({ page }, info) => {
    test.setTimeout(120_000);
    // Steps 1–4: services are a precondition; capture Singapore date and list baseline.
    const started = new Date();
    const date = singaporeTestDate(started);
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(started);
    const tag = `${date.iso} ${clock}.${String(started.getMilliseconds()).padStart(3, "0")}`;
    const name = `${NAME} ${id} ${tag}`;
    await info.attach("test-date", { body: `EVENT_DATE=${date.iso}; RUN_TAG=${tag}; EVENT_NAME=${name}; timezone=Asia/Singapore`, contentType: "text/plain" });
    await login(page, MAYA, /\/my-events$/);
    const views = page.getByRole("link", { name: "View", exact: true });
    const before = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
    await action(page, "New event request").click();

    // Steps 5–7: all fields match the written TC, including blanks and selections.
    await page.getByPlaceholder("Alumni Homecoming Dinner").fill(name);
    await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
    await field(page, "Expected attendance").locator("input").fill("85");
    await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
    await field(page, "Proposed date").locator("input").fill(date.iso);
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
    const quantities = page.locator('[class*="stepperValue"]');
    expect(await quantities.count()).toBeGreaterThan(0);
    for (const quantity of await quantities.all()) await expect(quantity).toHaveText("0");
    await expect(page.getByPlaceholder("Connections, setup, compatibility or power needs")).toHaveCount(0);
    await action(page, "Continue").click();
    await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();
    expect(singaporeTestDate(new Date()).iso, "Restart if midnight crossed before submission.").toBe(date.iso);
    await action(page, "Submit for review").click();

    // Steps 8–10: use the actual new IDs, never an old same-named event.
    await expect(page).toHaveURL(/\/my-events$/);
    await expect(views).toHaveCount(before.length + 1);
    const href = (await views.evaluateAll(links => links.map(link => link.getAttribute("href"))))
      .find(value => !before.includes(value))!;
    expect(href).toBeTruthy();
    const eventId = href.split("/").pop()!;
    const row = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
    await expect(row.locator(".pill")).toHaveText("Submitted");
    await row.getByRole("button", { name: "Request change", exact: true }).click();
    await page.locator("textarea.textarea-input").fill(PROPOSAL);
    await action(page, "Submit change request").click();
    await expect(page.getByText("Change request submitted.", { exact: true })).toBeVisible();
    await page.locator(`a[href="${href}"]`).click();
    const proposals = page.getByRole("region", { name: "Change requests", exact: true });
    await expect(proposals.getByRole("listitem")).toHaveCount(1);
    await expect(proposals).toContainText(PROPOSAL);
    await expect(proposals).toContainText("Awaiting coordinator review");
    const requestLabel = (await proposals.getByRole("listitem").innerText()).match(/Request #(\d+)/)![0];

    // Steps 11–14: the Lead's assignment (US43/US11), then the coordinator's comparison, not event approval.
    await logout(page);
    await login(page, JORDAN, /\/assignments/);
    const request = page.getByRole("region", { name: "Unassigned requests", exact: true })
      .locator('[aria-label^="Unassigned request:"]').filter({ hasText: `EVT-${eventId} ·` });
    await expect(request).toContainText(name);
    await request.getByLabel("Coordinator to assign").selectOption({ label: PRIYA.name });
    await request.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(request).toHaveCount(0);
    await logout(page);
    await login(page, PRIYA, /\/queue/);
    await queueEvent(page, eventId, name);
    const arrangements = page.getByRole("region", { name: "Existing arrangements", exact: true });
    await expect(arrangements).toContainText(`Event: ${date.label}, 18:00–21:00; expected attendance 85.`);
    for (const text of ["No venue bookings recorded.", "Equipment: None.", "Registration: Disabled."]) {
      await expect(arrangements).toContainText(text);
    }
    await expect(proposals).toContainText(requestLabel);
    await expect(proposals).toContainText(PROPOSAL);

    // Steps 15–17: blank reason is valid for both outcomes; refresh preserves audit.
    await expect(proposals.getByLabel("Review note (optional)")).toHaveValue("");
    await proposals.getByRole("button", { name: decisionButton, exact: true }).click();
    await expect(proposals).toContainText(`${requestLabel} · ${outcome}`);
    await expect(proposals).toContainText("Reviewed by Priya Tan");
    await expect(proposals.getByRole("button")).toHaveCount(0);
    const decisionTime = await proposals.locator("time").last().getAttribute("datetime");
    expect(decisionTime).toBeTruthy();
    await expect(page.locator('[class*="EventWorkspace"][class*="headerTop"] .pill')).toHaveText("Submitted");
    await expect(arrangements).toContainText("expected attendance 85");
    await expect(arrangements).toContainText("No venue bookings recorded.");
    await expect(arrangements).toContainText("Equipment: None.");
    await page.reload();
    await queueEvent(page, eventId, name);
    await expect(proposals).toContainText(`${requestLabel} · ${outcome}`);
    await expect(proposals).toContainText("Reviewed by Priya Tan");
    await expect(proposals.locator("time").last()).toHaveAttribute("datetime", decisionTime!);
    await expect(proposals.getByRole("button")).toHaveCount(0);

    // Steps 18–19: the requesting organiser receives the matching saved decision notice.
    await logout(page);
    await login(page, MAYA, /\/my-events$/);
    await expect(views).toHaveCount(before.length + 1);
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: name })
      .filter({ hasText: `Change request ${outcome}` });
    async function checkNotice() {
      await page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText(`your change request was ${outcome}`);
    }
    await checkNotice();
    await notice.getByRole("button", { name: "Open event", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/my-events/${eventId}$`));
    await expect(proposals).toContainText(`${requestLabel} · ${outcome}`);
    await expect(proposals).toContainText(PROPOSAL);
    await expect(proposals).toContainText("Reviewed by Priya Tan");
    await expect(proposals.locator("time").last()).toHaveAttribute("datetime", decisionTime!);
    await expect(page.locator(".pill").first()).toHaveText("Submitted");
    const details = page.getByRole("region", { name: "Event", exact: true });
    for (const [label, value] of [["Expected attendance", "85"], ["Date", date.label], ["Time", "18:00 – 21:00"]]) {
      await expect(details.locator("dt").filter({ hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::dd[1]")).toHaveText(value);
    }
    await expect(page.locator("input, select, textarea")).toHaveCount(0);
    await expect(proposals.getByRole("button")).toHaveCount(0);

    // Steps 20–22: the notice survives refresh and fresh login, and still opens this event.
    await page.reload();
    await checkNotice();
    await logout(page);
    await login(page, MAYA, /\/my-events$/);
    await checkNotice();
    await notice.getByRole("button", { name: "Open event", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/my-events/${eventId}$`));
    await logout(page);
    const record = `EVENT_DATE=${date.iso}; EVENT_NAME=${name}; EVENT_ID=${eventId}; ${requestLabel}; decision=${outcome}; at=${decisionTime}; count=${before.length}->${before.length + 1}; ${shared ? "shared acceptance" : "isolated regression"}`;
    console.log(`${id} ${record}`);
    await info.attach("record-ids", { body: record, contentType: "text/plain" });
  });
}

test("[US34-REGRESSION][AC2] booked event exposes existing arrangements without applying a decision", async ({ page, baseURL }) => {
  test.skip(shared, "API-prepared fixture is isolated regression, never a shared TC execution.");
  const scenario = seedScenario("US34 arrangement regression");
  const organiser = await apiAs(baseURL!, MAYA);
  const response = await organiser.post(`/api/events/${scenario.symposium}/change-requests`, { data: { proposed_changes: PROPOSAL } });
  expect(response.status()).toBe(201);
  await organiser.dispose();
  await login(page, PRIYA, /\/queue/);
  await action(page, "All").click();
  await page.getByPlaceholder(/search events/i).fill(`EVT-${scenario.symposium}`);
  await page.locator('button[class*="QueueList"][class*="row"]').filter({ hasText: "Annual Research Symposium" }).click();
  const arrangements = page.getByRole("region", { name: "Existing arrangements", exact: true });
  await expect(arrangements).toContainText("approved");
  await expect(arrangements).not.toContainText("No venue bookings recorded.");
  await expect(arrangements).toContainText("Projector");
  await expect(arrangements).toContainText("registered / capacity");
  await expect(page.getByRole("region", { name: "Change requests", exact: true })).toContainText(PROPOSAL);
  await logout(page);
});
