import { expect, test, type Page } from "@playwright/test";
import { action, HANNAH, JORDAN, MAYA, PASSWORD, PRIYA } from "./support/app";
import { DANIEL, resultCard } from "./support/venues";
import { singaporeTestDate } from "./support/dates";

// US33-TC02 follows the written UI setup, including US44 safety and US14 confirmation.
// Passwords for shared coursework accounts are supplied to the process, never committed.
const shared = process.env.TC_SHARED_DB === "1";
const PURPOSE = "Verify a confirmed event accepts a proposal without direct edits.";
const PROPOSAL = "Increase expected attendance from 85 to 90.";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
test.use({ timezoneId: "Asia/Singapore", actionTimeout: 15_000 });

async function login(page: Page, person: typeof MAYA, key: string, landing: RegExp) {
  const password = shared ? process.env[key] : PASSWORD;
  if (!password) throw new Error(`Missing authorised ${key}.`);
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(person.email);
  await page.locator('input[type="password"]').fill(password);
  // Saved rows must have loaded before the organiser's list baseline is captured.
  const loaded = person === MAYA ? page.waitForResponse(r => r.url().endsWith("/api/events") && r.request().method() === "GET") : null;
  await action(page, "Sign in").click();
  await expect(page).toHaveURL(landing);
  if (loaded) {
    const response = await loaded;
    expect(response.ok()).toBeTruthy();
    await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount((await response.json()).length);
  }
}

async function logout(page: Page) {
  const done = page.waitForResponse(r => r.url().includes("/api/auth/logout") && r.request().method() === "POST");
  await action(page, "Sign out").click();
  expect((await done).status()).toBe(204);
  await expect(page).toHaveURL(/\/login/);
}

function field(page: Page, label: string) {
  return page.locator("div.field").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}

test("[US33-TC02][AC1–AC3] confirmed event keeps its details when the organiser requests a change", async ({ page }, info) => {
  test.setTimeout(300_000); // Five real roles prepare the event through the same UI as the TC.
  // Steps 1–2: tomorrow keeps the initial venue hold valid, even when run late today.
  const started = new Date();
  const today = singaporeTestDate(started);
  const date = singaporeTestDate(new Date(started.getTime() + 24 * 60 * 60 * 1000));
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(started);
  const tag = `${today.iso} ${clock}.${String(started.getMilliseconds()).padStart(3, "0")}`;
  const name = `US33 Confirmed Change Test ${tag}`;
  const venue = `US33 Confirmed Hall ${tag}`;
  await info.attach("test-data", { body: `EVENT_DATE=${date.iso}; EVENT_NAME=${name}; VENUE_NAME=${venue}; timezone=Asia/Singapore`, contentType: "text/plain" });

  // Steps 3–4: a fresh venue avoids depending on old bookings or a fixed catalogue ID.
  await login(page, DANIEL, "TC_DANIEL_PASSWORD", /\/bookings/);
  await page.goto("/catalogue");
  await action(page, "+ Add Venue").click();
  await page.getByLabel("Venue name", { exact: true }).fill(venue);
  await page.getByLabel("Location", { exact: true }).fill("US33 test campus");
  await page.getByLabel("Capacity", { exact: true }).fill("150");
  const form = page.locator(".card").filter({ has: page.getByLabel("Venue name", { exact: true }) });
  const selected = new Set(["Banquet", "PA system", "Wheelchair Access", ...DAYS]);
  for (const checkbox of await form.getByRole("checkbox").all()) {
    await checkbox.setChecked(selected.has((await checkbox.locator("..").innerText()).trim()));
  }
  await page.getByLabel("Opening time").fill("06:00");
  await page.getByLabel("Closing time").fill("23:00");
  await page.getByLabel("Setup minutes").fill("0");
  await page.getByLabel("Turnaround minutes").fill("0");
  await action(page, "Save Venue").click();
  await expect(page.getByText(venue, { exact: true })).toBeVisible();

  // Steps 5–10: create the event through all three form pages and capture its actual ID.
  await logout(page);
  await login(page, MAYA, "TC_MAYA_PASSWORD", /\/my-events$/);
  const views = page.getByRole("link", { name: "View", exact: true });
  const before = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
  await action(page, "New event request").click();
  await page.getByPlaceholder("Alumni Homecoming Dinner").fill(name);
  await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
  await field(page, "Expected attendance").locator("input").fill("85");
  await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
  await field(page, "Proposed date").locator("input").fill(date.iso);
  await field(page, "Start").locator("input").fill("10:00");
  await field(page, "End").locator("input").fill("12:00");
  await action(page, "Continue").click();
  await field(page, "Preferred venue location").locator("input").fill("");
  await field(page, "Required capacity").locator("input").fill("");
  const banquet = action(page, "Banquet");
  if (!(await banquet.getAttribute("class"))?.includes("chipOn")) await banquet.click();
  for (const [label, wanted] of [["Facilities needed", "PA system"], ["Accessibility needs", "Wheelchair Access"]]) {
    for (const button of await field(page, label).getByRole("button").all()) {
      const on = (await button.getAttribute("class"))?.includes("chipOn") ?? false;
      if (on !== ((await button.innerText()) === wanted)) await button.click();
    }
  }
  const quantities = page.locator('[class*="stepperValue"]');
  expect(await quantities.count()).toBeGreaterThan(0);
  for (const quantity of await quantities.all()) await expect(quantity).toHaveText("0");
  await expect(page.getByPlaceholder("Connections, setup, compatibility or power needs")).toHaveCount(0);
  await action(page, "Continue").click();
  await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();
  expect(singaporeTestDate(new Date()).iso, "Restart if the setup crosses Singapore midnight.").toBe(today.iso);
  await action(page, "Submit for review").click();
  await expect(page).toHaveURL(/\/my-events$/);
  await expect(views).toHaveCount(before.length + 1);
  const href = (await views.evaluateAll(links => links.map(link => link.getAttribute("href")))).find(h => !before.includes(h))!;
  expect(href).toBeTruthy();
  const eventId = href.split("/").pop()!;
  const row = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(row).toContainText(name);
  await expect(row.locator(".pill")).toHaveText("Submitted");
  const workspace = page.locator('[class*="EventWorkspace"][class*="headerMain"]');
  async function queueEvent() {
    await action(page, "All").click();
    await page.getByPlaceholder(/search events/i).fill(`EVT-${eventId}`);
    await page.locator('button[class*="QueueList"][class*="row"]').filter({ hasText: name }).click();
    await expect(workspace).toContainText(name);
    await expect(workspace).toContainText(`EVT-${eventId}`);
  }

  // Steps 11–15: the Lead assigns; the assigned coordinator reviews and approves.
  await logout(page);
  await login(page, JORDAN, "TC_JORDAN_PASSWORD", /\/assignments/);
  const unassigned = page.getByRole("region", { name: "Unassigned requests", exact: true }).locator('[aria-label^="Unassigned request:"]').filter({ hasText: `EVT-${eventId} ·` });
  await expect(unassigned).toContainText(name);
  await unassigned.getByLabel("Coordinator to assign").selectOption({ label: PRIYA.name });
  await unassigned.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(unassigned).toHaveCount(0);
  await logout(page);
  await login(page, PRIYA, "TC_PRIYA_PASSWORD", /\/queue/);
  await queueEvent();
  await action(page, "Start review").click();
  await expect(workspace.locator(".pill")).toHaveText("Under Review");
  await action(page, "Approve").click();
  await page.locator("textarea.textarea-input").fill("");
  await action(page, "Approve request").click();
  await expect(workspace.locator(".pill")).toHaveText("Approved");

  // Steps 16–21: request this venue once; Venue Staff approve it before safety review.
  await action(page, "Venue").click();
  const booking = page.getByLabel("New booking", { exact: true });
  await booking.getByLabel("Purpose", { exact: true }).fill("Main programme");
  await booking.getByLabel("Attendance", { exact: true }).fill("85");
  await booking.locator("select").selectOption({ label: "Banquet" });
  await page.locator('input[class*="capInput"]').fill("0");
  const savedBooking = page.waitForResponse(r => /\/api\/venues\/\d+\/booking-requests$/.test(r.url()) && r.request().method() === "POST");
  await resultCard(page, venue).getByRole("button", { name: "Request booking", exact: true }).click();
  const bookedResponse = await savedBooking;
  expect(bookedResponse.ok()).toBeTruthy();
  const bookingId = (await bookedResponse.json()).booking.id;
  await expect(page.getByLabel(`Booking at ${venue}`, { exact: true })).toContainText("Pending");
  await logout(page);
  await login(page, DANIEL, "TC_DANIEL_PASSWORD", /\/bookings/);
  const pending = page.getByLabel(`Booking request: ${name} at ${venue}`, { exact: true });
  await pending.getByRole("button", { name: "Approve booking", exact: true }).click();
  await expect(pending).toHaveCount(0);
  await logout(page);
  await login(page, PRIYA, "TC_PRIYA_PASSWORD", /\/queue/);
  await queueEvent();
  await action(page, "Request safety check").click();
  await expect(workspace.locator(".pill")).toHaveText("Pending Safety Review");

  // Steps 22–26: a real Safety Officer decision, then real persisted US14 confirmation.
  await logout(page);
  await login(page, HANNAH, "TC_HANNAH_PASSWORD", /\/safety/);
  const safety = page.getByLabel("Awaiting a safety check", { exact: true }).getByLabel(`Safety check: ${name}`, { exact: true });
  await expect(safety.locator("section")).toHaveCount(7);
  await safety.getByLabel("Comment", { exact: true }).fill("");
  await safety.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByLabel("Already reviewed", { exact: true }).getByLabel(`Safety check: ${name}`, { exact: true })).toContainText("Safety Approved");
  await logout(page);
  await login(page, PRIYA, "TC_PRIYA_PASSWORD", /\/queue/);
  await queueEvent();
  await expect(page.getByLabel("Confirmation", { exact: true })).toContainText("is ready to confirm");
  await action(page, "Confirm event").click();
  await expect(workspace.locator(".pill")).toHaveText("Confirmed");
  await page.reload();
  await queueEvent();
  await expect(workspace.locator(".pill")).toHaveText("Confirmed");

  // Steps 27–31: a proposal is saved, while the confirmed event remains read-only and unchanged.
  await logout(page);
  await login(page, MAYA, "TC_MAYA_PASSWORD", /\/my-events$/);
  await expect(row.locator(".pill")).toHaveText("Confirmed");
  await row.getByRole("button", { name: "Request change", exact: true }).click();
  await page.locator("textarea.textarea-input").fill(PROPOSAL);
  await action(page, "Submit change request").click();
  await expect(page.getByText("Change request submitted.", { exact: true })).toBeVisible();
  await page.locator(`a[href="${href}"]`).click();
  const proposals = page.getByRole("region", { name: "Change requests", exact: true });
  await expect(proposals.getByRole("listitem")).toHaveCount(1);
  const requestLabel = (await proposals.getByRole("listitem").innerText()).match(/Request #(\d+)/)![0];
  async function unchanged() {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.locator(".pill").first()).toHaveText("Confirmed");
    await expect(proposals).toContainText(requestLabel);
    await expect(proposals).toContainText(PROPOSAL);
    await expect(proposals).toContainText("Awaiting coordinator review");
    const details = page.getByRole("region", { name: "Event", exact: true });
    for (const [label, value] of [["Expected attendance", "85"], ["Date", date.label], ["Time", "10:00 – 12:00"]]) {
      await expect(details.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]")).toHaveText(value);
    }
    await expect(page.getByText(PURPOSE, { exact: true })).toBeVisible();
    await expect(page.locator("input, select, textarea")).toHaveCount(0);
  }
  await unchanged();
  await page.reload();
  await unchanged();
  await logout(page);
  await login(page, MAYA, "TC_MAYA_PASSWORD", /\/my-events$/);
  await expect(views).toHaveCount(before.length + 1);
  await page.locator(`a[href="${href}"]`).click();
  await unchanged();

  // Steps 32–36: the saved notification leads the coordinator back to this confirmed event.
  await logout(page);
  await login(page, PRIYA, "TC_PRIYA_PASSWORD", /\/queue/);
  const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: name }).filter({ hasText: "Change requested" });
  async function checkNotice() {
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText(PROPOSAL);
  }
  async function openNotice() {
    await notice.getByRole("button", { name: "Open event", exact: true }).click();
    await expect(workspace).toContainText(name);
    await expect(workspace).toContainText(`EVT-${eventId}`);
    await expect(workspace.locator(".pill")).toHaveText("Confirmed");
    await expect(proposals).toContainText(requestLabel);
    await expect(proposals).toContainText(PROPOSAL);
    await expect(proposals).toContainText("Awaiting coordinator review");
    await expect(page.getByRole("region", { name: "Existing arrangements", exact: true })).toContainText(`Event: ${date.label}, 10:00–12:00; expected attendance 85.`);
  }
  await checkNotice();
  await openNotice();
  await page.reload();
  await checkNotice();
  await logout(page);
  await login(page, PRIYA, "TC_PRIYA_PASSWORD", /\/queue/);
  await checkNotice();
  await openNotice();
  await logout(page);
  const record = `EVENT_DATE=${date.iso}; EVENT_NAME=${name}; VENUE_NAME=${venue}; EVENT_ID=${eventId}; BOOKING_ID=${bookingId}; ${requestLabel}; status=confirmed; attendance=85; count=${before.length}->${before.length + 1}; ${shared ? "shared acceptance" : "isolated regression"}`;
  console.log(`US33-TC02 ${record}`);
  await info.attach("record-ids", { body: record, contentType: "text/plain" });
});
