import { expect, test, type Page } from "@playwright/test";
import { action, MAYA, PASSWORD } from "./support/app";

/** US33-TC01: same UI preparation, input and checkpoints as the written TC.
 * CI uses isolated fixture credentials; shared acceptance is a separate opt-in.
 */
const NAME = "US33 Event Change Request Test";
const PURPOSE = "Verify a proposed change is saved without changing the event.";
const PROPOSAL = "Increase expected attendance from 85 to 90.";
const shared = process.env.TC_SHARED_DB === "1";

function field(page: Page, label: string) {
  return page.locator("div.field").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
}

async function login(page: Page) {
  const password = shared ? process.env.TC_MAYA_PASSWORD : PASSWORD;
  if (!password) throw new Error("Missing authorised TC_MAYA_PASSWORD.");
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(MAYA.email);
  await page.locator('input[type="password"]').fill(password);
  const loaded = page.waitForResponse(r => r.url().endsWith("/api/events") && r.request().method() === "GET");
  await action(page, "Sign in").click();
  await expect(page).toHaveURL(/\/my-events$/);
  const response = await loaded;
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  await expect(page.getByRole("link", { name: "View", exact: true })).toHaveCount(saved.length);
}

async function logout(page: Page) {
  const done = page.waitForResponse(r => r.url().includes("/api/auth/logout") && r.request().method() === "POST");
  await action(page, "Sign out").click();
  expect((await done).status()).toBe(204);
  await expect(page).toHaveURL(/\/login/);
}

test("[US33-TC01] persist a proposal without directly editing the event", async ({ page }, info) => {
  test.setTimeout(120_000);
  // Steps 1–4: services are a precondition; login and capture the loaded baseline.
  await login(page);
  const views = page.getByRole("link", { name: "View", exact: true });
  const before = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
  await action(page, "New event request").click();

  // Steps 5–7: all written inputs are explicit; no API-created fixture.
  await page.getByPlaceholder("Alumni Homecoming Dinner").fill(NAME);
  await page.getByPlaceholder("What is this event for, and who is it for?").fill(PURPOSE);
  await field(page, "Expected attendance").locator("input").fill("85");
  await field(page, "Event type").locator("select").selectOption({ label: "Conference" });
  await field(page, "Proposed date").locator("input").fill("2026-11-20");
  await field(page, "Start").locator("input").fill("18:00");
  await field(page, "End").locator("input").fill("21:00");
  await action(page, "Continue").click();
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
  await page.getByRole("checkbox", { name: /Enable attendee registration/ }).uncheck();
  await action(page, "Submit for review").click();

  // Steps 8–10: capture this run's event; submit the proposal exactly once.
  await expect(page).toHaveURL(/\/my-events$/);
  await expect(views).toHaveCount(before.length + 1);
  const after = await views.evaluateAll(links => links.map(link => link.getAttribute("href")));
  const href = after.find(value => !before.includes(value))!;
  expect(href).toBeTruthy();
  const eventId = href.split("/").pop()!;
  const row = page.locator('[class*="MyEventsTable"][class*="row"]').filter({ has: page.locator(`a[href="${href}"]`) });
  await expect(row.locator(".pill")).toHaveText("Submitted");
  await row.getByRole("button", { name: "Request change", exact: true }).click();
  await expect(page.getByText("Request a change", { exact: true })).toBeVisible();
  await page.locator("textarea.textarea-input").fill(PROPOSAL);
  await action(page, "Submit change request").click();
  await expect(page.getByText("Change request submitted.", { exact: true })).toBeVisible();
  await expect(page.locator("textarea.textarea-input")).toHaveCount(0);
  await page.locator(`a[href="${href}"]`).click();

  // Steps 11–13: one persisted request, unchanged event, same IDs after refresh.
  const proposals = page.getByRole("region", { name: "Change requests", exact: true });
  await expect(proposals.getByRole("listitem")).toHaveCount(1);
  await expect(proposals).toContainText(PROPOSAL);
  await expect(proposals).toContainText("Awaiting coordinator review");
  const requestLabel = (await proposals.getByRole("listitem").innerText()).match(/Request #(\d+)/)![0];
  async function unchanged() {
    await expect(page.getByRole("heading", { name: NAME, exact: true })).toBeVisible();
    await expect(page.locator(".pill").first()).toHaveText("Submitted");
    const details = page.getByRole("region", { name: "Event", exact: true });
    for (const [label, value] of [["Expected attendance", "85"], ["Date", "20 Nov 2026"], ["Time", "18:00 – 21:00"]]) {
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

  // Steps 14–16: new session, same proposal, no additional event, sign out.
  await logout(page);
  await login(page);
  await expect(views).toHaveCount(before.length + 1);
  await page.locator(`a[href="${href}"]`).click();
  await expect(proposals).toContainText(requestLabel);
  await expect(proposals).toContainText(PROPOSAL);
  await expect(proposals).toContainText("Awaiting coordinator review");
  await unchanged();
  await logout(page);
  console.log(`US33-TC01 EVENT_ID=${eventId}; ${requestLabel}`);
  await info.attach("record-ids", { body: `EVENT_ID=${eventId}; ${requestLabel}; ${shared ? "shared acceptance" : "isolated regression"}`, contentType: "text/plain" });
});
