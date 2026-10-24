import { expect, test, type Page } from "@playwright/test";
import { action, ALEX, MAYA, PASSWORD } from "./support/app";

const shared = process.env.TC_SHARED_DB === "1";
const NAME = "US06 Ownership Test";
const PURPOSE = "Testing draft ownership";

/** US06-TC02: the same fresh-draft/account-switch procedure as the English TC. */
async function login(page: Page, person: typeof MAYA) {
  const password = shared ? process.env[person.email === MAYA.email ? "TC_MAYA_PASSWORD" : "TC_ALEX_PASSWORD"] : PASSWORD;
  if (!password) throw new Error("Missing authorised TC password.");
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(person.email);
  await page.locator('input[type="password"]').fill(password);
  const loaded = page.waitForResponse(r => r.url().endsWith("/api/events") && r.request().method() === "GET");
  await action(page, "Sign in").click();
  await expect(page).toHaveURL(/\/my-events$/);
  const response = await loaded;
  expect(response.ok(), "The saved event list must load before checking ownership.").toBeTruthy();
  await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount((await response.json()).length);
  await expect(page.getByText(person.name, { exact: true })).toBeVisible();
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

test("[US06-TC02][AC4] a fresh Maya draft stays private after switching to Alex", async ({ page }, info) => {
  test.setTimeout(120_000);
  // Steps 1–6: services started as a precondition; capture the fully loaded baseline.
  await login(page, MAYA);
  await page.getByRole("link", { name: /^My events$/i }).click();
  const views = page.getByRole("link", { name: "View", exact: true });
  const before = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));

  // Steps 7–10: save from Basics. Do not advance into Requirements/Registration.
  await action(page, "New event request").click();
  await page.getByPlaceholder("Alumni Homecoming Dinner").fill(NAME);
  await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
  await field(page, "Expected attendance").locator("input").fill("80");
  await field(page, "Event type").locator("select").selectOption("");
  await field(page, "Proposed date").locator("input").fill("");
  await field(page, "Start").locator("input").fill("18:00");
  await field(page, "End").locator("input").fill("21:00");
  // The unopened settings retain the explicit fresh-form values listed in the TC.
  await action(page, "Save as draft").click();

  // Step 11: find this run's generated ID, not a fixed ID or just a duplicate name.
  await expect(page).toHaveURL(/\/my-events$/);
  await expect(views).toHaveCount(before.length + 1);
  const href = (await views.evaluateAll(links => links.map(link => link.getAttribute("href"))))
    .find(value => !before.includes(value))!;
  expect(href).toBeTruthy();
  const draftId = href.split("/").pop()!;
  const row = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(row).toContainText(NAME);
  await expect(row.locator(".pill")).toHaveText("Draft");
  await expect(row.getByText("80", { exact: true })).toBeVisible();

  // Steps 12–15: Alex has his own list; it need not be empty.
  await logout(page);
  await login(page, ALEX);
  await page.getByRole("link", { name: /^My events$/i }).click();
  await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);

  // Steps 16–21: Maya still owns the same unmodified draft after re-login.
  await logout(page);
  await login(page, MAYA);
  await page.getByRole("link", { name: /^My events$/i }).click();
  await expect(views).toHaveCount(before.length + 1);
  await expect(row.locator(".pill")).toHaveText("Draft");
  await row.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByPlaceholder("Alumni Homecoming Dinner")).toHaveValue(NAME);
  await expect(page.getByPlaceholder("What is this event for, and who is it for?")).toHaveValue(PURPOSE);
  await expect(field(page, "Expected attendance").locator("input")).toHaveValue("80");

  // Steps 22–23: leave without another save/submission, then sign out.
  await page.getByRole("link", { name: /^My events$/i }).click();
  await expect(row.locator(".pill")).toHaveText("Draft");
  await logout(page);
  const record = `DRAFT_ID=${draftId}; Maya count ${before.length} -> ${before.length + 1}; Alex cannot see the ID; original values retained; ${shared ? "shared acceptance" : "isolated regression"}`;
  console.log(`US06-TC02 ${record}`);
  await info.attach("record-ids", { body: record, contentType: "text/plain" });
});
