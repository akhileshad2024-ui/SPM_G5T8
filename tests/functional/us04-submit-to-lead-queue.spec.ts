import { expect, test, type Page } from "@playwright/test";
import { action, JORDAN, MAYA, PASSWORD } from "./support/app";
import { singaporeTestDate } from "./support/dates";

const shared = process.env.TC_SHARED_DB === "1";
const NAME = "US04 Lead Queue Handover Test";
const PURPOSE = "Testing submission to the Lead queue";
test.use({ timezoneId: "Asia/Singapore" });

// Credentials differ by environment; business actions never bypass the UI.
async function login(page: Page, person: typeof MAYA, landing: RegExp) {
  const password = shared
    ? process.env[person.email === MAYA.email ? "TC_MAYA_PASSWORD" : "TC_JORDAN_PASSWORD"]
    : PASSWORD;
  if (!password) throw new Error("Supply the authorised TC password before running.");
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(person.email);
  await page.locator('input[type="password"]').fill(password);
  const loaded = page.waitForResponse(r => r.url().endsWith("/api/events") && r.request().method() === "GET");
  await action(page, "Sign in").click();
  await expect(page).toHaveURL(landing);
  const response = await loaded;
  expect(response.ok(), "The UI must load saved events before checking them.").toBeTruthy();
  if (person.email === MAYA.email) {
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

test("[US04-TC03][US04-AC4] UI submission reaches the Lead queue without automatic assignment", async ({ page }, info) => {
  test.setTimeout(120_000);
  const date = singaporeTestDate(new Date()); // Capture once; no expiring literal date.
  await info.attach("test-date", { body: `EVENT_DATE=${date.iso}; Asia/Singapore`, contentType: "text/plain" });

  // TC steps 1–5: real login and a fully loaded baseline, not a fixed count/ID.
  await login(page, MAYA, /\/my-events$/);
  await page.getByRole("link", { name: /^My events$/i }).click();
  const views = page.getByRole("link", { name: "View", exact: true });
  const before = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
  await action(page, "New event request").click();

  // Steps 6–10: the exact English TC inputs, including explicit selections.
  await page.getByPlaceholder("Alumni Homecoming Dinner").fill(NAME);
  await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
  await field(page, "Expected attendance").locator("input").fill("85");
  await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
  await field(page, "Proposed date").locator("input").fill(date.iso);
  await field(page, "Start").locator("input").fill("18:00");
  await field(page, "End").locator("input").fill("21:00");
  await action(page, "Continue").click();
  await field(page, "Preferred venue location").locator("input").fill("");
  await field(page, "Required capacity").locator("input").fill("");
  await action(page, "Banquet").click();
  for (const [label, selected] of [["Facilities needed", "PA system"], ["Accessibility needs", "Wheelchair Access"]]) {
    const choices = field(page, label);
    for (const button of await choices.getByRole("button").all()) {
      const wanted = (await button.innerText()) === selected;
      const on = (await button.getAttribute("class"))?.includes("chipOn") ?? false;
      if (wanted !== on) await button.click();
    }
    await expect(choices.getByRole("button", { name: selected, exact: true })).toHaveClass(/chipOn/);
  }
  const quantities = page.locator('[class*="stepperValue"]');
  expect(await quantities.count()).toBeGreaterThan(0);
  for (const quantity of await quantities.all()) await expect(quantity).toHaveText("0");
  await expect(page.getByPlaceholder("Connections, setup, compatibility or power needs")).toHaveCount(0);
  await action(page, "Continue").click();
  await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();

  // Steps 11–12: submit ONCE; find the new ID by baseline difference.
  expect(singaporeTestDate(new Date()).iso, "Restart if midnight crossed before submission.").toBe(date.iso);
  await action(page, "Submit for review").click();
  await expect(page).toHaveURL(/\/my-events$/);
  await expect(views).toHaveCount(before.length + 1);
  const added = (await views.evaluateAll(links => links.map(link => link.getAttribute("href"))))
    .filter(href => !before.includes(href));
  expect(added).toHaveLength(1);
  const href = added[0]!;
  const id = href.split("/").pop()!;
  const row = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(row).toContainText(NAME);
  await expect(row.getByText("85", { exact: true })).toBeVisible();
  await expect(row.locator(".pill")).toHaveText("Submitted");
  await expect(row.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Submit/ })).toHaveCount(0);
  const record = `EVENT_ID=${id}; EVENT_DATE=${date.iso}; Maya count ${before.length} -> ${before.length + 1}; environment=${shared ? "shared acceptance" : "isolated regression"}`;
  console.log(`US04-TC03 ${record}`);
  await info.attach("event-record", { body: record, contentType: "text/plain" });

  // Steps 13–20: Lead reads the SAME ID, including fresh page/session checks.
  await logout(page);
  await login(page, JORDAN, /\/assignments$/);
  const card = page.getByRole("region", { name: "Unassigned requests", exact: true })
    .locator('[aria-label^="Unassigned request:"]').filter({ hasText: `EVT-${id} ·` });
  async function checkUnassigned() {
    await expect(card).toHaveCount(1);
    for (const value of [NAME, PURPOSE, MAYA.name, date.label, "18:00–21:00", "85 expected"]) await expect(card).toContainText(value);
    await expect(card.locator(".pill")).toHaveText("Submitted");
    await expect(card.getByLabel("Coordinator to assign")).toHaveValue("");
    await expect(card.getByRole("button", { name: "Assign", exact: true })).toBeDisabled();
    await card.getByRole("button", { name: "Details", exact: true }).click();
    await expect(card.getByRole("region", { name: "People", exact: true })).toContainText("Not yet assigned");
  }
  await checkUnassigned();
  await page.reload();
  await checkUnassigned();
  await logout(page);
  await login(page, JORDAN, /\/assignments$/);
  await checkUnassigned();
  await logout(page); // Leave data intact; never assign/delete/reset for test cleanup.
});
