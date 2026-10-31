import { expect, test, type Page } from "@playwright/test";
import { GRACE, MARCUS, MAYA, PRIYA, apiAs, assignTo, createRequest, signIn, toast, unique } from "./support/app";
import { observed } from "./support/venues";

/**
 * US12 — Reassign Event Coordinator (functional). Week 7 change CR-W7-5.
 * "As an Event Coordinator Lead, I want to reassign an event to another Event Coordinator so that
 * coordination can continue when staff availability or responsibilities change."
 *
 * Grace Ong is the Lead; Priya Tan and Marcus Lee are coordinators (tests/functional/support/seed_users.py).
 * "Given" steps (a submitted request, its first assignment) go through the API; the Lead reassigns in the
 * browser. Acceptance criteria: docs/user-stories/US12_reassign_coordinator.md
 */
const REASON = "Priya is on leave for the next two weeks.";

const coordinatorCard = (page: Page, name: string) => page.locator(`[aria-label="Coordinator: ${name}"]`);
const assignedEvent = (page: Page, coordinator: string, event: string) =>
  coordinatorCard(page, coordinator).locator(`[aria-label="Assigned event: ${event}"]`);

/** Given: Maya submitted a request and Grace assigned it to Priya. Returns its name. */
async function assignedToPriya(baseURL: string, label: string): Promise<string> {
  const name = unique(label);
  await assignTo(await apiAs(baseURL, GRACE), await createRequest(await apiAs(baseURL, MAYA), name), PRIYA);
  return name;
}

/** On the Assignments page: open Reassign for the event, choose the coordinator and give the reason. */
async function reassign(page: Page, event: string, to: string, reason: string) {
  const row = assignedEvent(page, PRIYA.name, event);
  await row.getByRole("button", { name: "Reassign", exact: true }).click();
  await row.getByLabel("Reassign to").selectOption(to);
  await row.getByLabel("Reason for reassignment").fill(reason);
  await row.getByRole("button", { name: "Confirm reassignment" }).click();
}

/** Switch user: leave the page first so no request in flight renews the old session cookie. */
async function switchTo(page: Page, who: typeof PRIYA, landing: RegExp) {
  await page.goto("about:blank");
  await page.context().clearCookies();
  await signIn(page, who, landing);
}

async function notification(page: Page, text: string) {
  await page.getByRole("button", { name: /Notifications/ }).click();
  return page.locator('[class*="NotificationsPanel_item__"]', { hasText: text }).first();
}

test.describe("US12 - Reassign Event Coordinator", () => {
  test("[US12-AC1] the Lead moves an event from one coordinator to another", async ({ page, baseURL }, info) => {
    const event = await assignedToPriya(baseURL!, "Charity Gala");

    await signIn(page, GRACE, /\/assignments$/);
    await reassign(page, event, MARCUS.name, REASON);

    await expect(toast(page)).toContainText(`${event} reassigned to ${MARCUS.name}`);
    await expect(assignedEvent(page, MARCUS.name, event)).toBeVisible();
    await expect(coordinatorCard(page, PRIYA.name)).not.toContainText(event);
    await page.reload();
    await expect(assignedEvent(page, MARCUS.name, event)).toBeVisible();  // saved
    observed(info, `After Grace reassigned "${event}" to Marcus and reloaded, it was listed under Marcus and no longer under Priya.`);
  });

  test("[US12-AC1] the current coordinator isn't offered as the new one", async ({ page, baseURL }) => {
    const event = await assignedToPriya(baseURL!, "Science Fair");

    await signIn(page, GRACE, /\/assignments$/);
    const row = assignedEvent(page, PRIYA.name, event);
    await row.getByRole("button", { name: "Reassign", exact: true }).click();

    await expect(row.getByLabel("Reassign to").locator("option", { hasText: PRIYA.name })).toHaveCount(0);
    await expect(row.getByLabel("Reassign to").locator("option", { hasText: MARCUS.name })).toHaveCount(1);
  });

  test("[US12-AC2] a reassignment needs a reason", async ({ page, baseURL }, info) => {
    const event = await assignedToPriya(baseURL!, "Open Day");

    await signIn(page, GRACE, /\/assignments$/);
    await reassign(page, event, MARCUS.name, "   ");

    await expect(toast(page)).toContainText("Reassignment reason is required.");
    await expect(assignedEvent(page, PRIYA.name, event).getByLabel("Reason for reassignment")).toBeVisible();  // form stays open
    await page.reload();
    await expect(assignedEvent(page, PRIYA.name, event)).toBeVisible();  // nothing changed
    observed(info, `Confirming with a blank reason showed "Reassignment reason is required."; after a reload "${event}" was still Priya's.`);
  });

  test("[US12-AC3] the previous coordinator loses the event and the new one gains it", async ({ page, baseURL }, info) => {
    const event = await assignedToPriya(baseURL!, "Design Week");
    await signIn(page, GRACE, /\/assignments$/);
    await reassign(page, event, MARCUS.name, REASON);
    await expect(assignedEvent(page, MARCUS.name, event)).toBeVisible();

    // Priya: the event has left her queue.
    await switchTo(page, PRIYA, /\/queue/);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder(/search events/i).fill(event);
    await expect(page.getByText("No events match this filter.").first()).toBeVisible();

    // Marcus: it is now in his.
    await switchTo(page, MARCUS, /\/queue/);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder(/search events/i).fill(event);
    await expect(page.getByRole("button", { name: new RegExp(event) }).first()).toBeVisible();
    observed(info, `After the reassignment, searching Priya's queue for "${event}" found nothing; Marcus's queue listed it.`);
  });

  test("[US12-AC4] the outgoing and incoming coordinators and the organiser are notified", async ({ page, baseURL }, info) => {
    const event = await assignedToPriya(baseURL!, "Pitch Night");
    await signIn(page, GRACE, /\/assignments$/);
    await reassign(page, event, MARCUS.name, REASON);
    await expect(assignedEvent(page, MARCUS.name, event)).toBeVisible();

    await switchTo(page, PRIYA, /\/queue/);
    await expect(await notification(page, event)).toContainText("You no longer manage it.");

    await switchTo(page, MARCUS, /\/queue/);
    await expect(await notification(page, event)).toContainText("reassigned this event to you");

    await switchTo(page, MAYA, /\/my-events/);
    await expect(await notification(page, event)).toContainText("a new Event Coordinator is now handling your event");
    observed(info, `Priya was told she no longer manages "${event}", Marcus that it was reassigned to him, and Maya that a new coordinator is handling it.`);
  });

  test("[US12-AC5] the Lead sees the complete assignment history", async ({ page, baseURL }, info) => {
    const event = await assignedToPriya(baseURL!, "Career Fair");
    await signIn(page, GRACE, /\/assignments$/);
    await reassign(page, event, MARCUS.name, REASON);

    const row = assignedEvent(page, MARCUS.name, event);
    await row.getByRole("button", { name: "History", exact: true }).click();

    const history = page.getByLabel(`Assignment history: ${event}`).locator("li");
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toContainText(`${GRACE.name} assigned ${PRIYA.name}`);
    await expect(history.nth(1)).toContainText(`${GRACE.name} reassigned it from ${PRIYA.name} to ${MARCUS.name}: ${REASON}`);
    observed(info, `History for "${event}": "${await history.nth(0).innerText()}" then "${await history.nth(1).innerText()}".`);
  });
});
