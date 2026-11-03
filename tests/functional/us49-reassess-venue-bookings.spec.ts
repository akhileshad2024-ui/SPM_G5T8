import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { HANNAH, MAYA, PRIYA, action, apiAs, openInQueue, signIn, toast } from "./support/app";
import { openBookings } from "./support/bookings";
import { decideVia, readyEvent, sendToCheck } from "./support/safety";
import { observed } from "./support/venues";

/**
 * US49 — Reassess Venue Bookings After an Accepted Change (functional). Split from US35; Week 7 change CR-W7-3.
 * "As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
 * when a change is accepted so that venue information remains consistent."
 *
 * "Given" steps (an approved event of 120 people booked into a 300-seat hall, Maya's change request) go through
 * the API; Priya accepts the change and Daniel (Venue Staff) resolves the flag in the browser. The flags are the
 * shared "Requires Reassessment" records (US50/US51/US45). Acceptance criteria: docs/user-stories/US49_reassess_venue_bookings.md
 */

const result = (page: Page) => page.getByLabel("Accepted change reassessment");
const coordinatorPanel = (page: Page) => page.getByRole("region", { name: "Arrangement reassessments", exact: true });
const staffPanel = (page: Page, name: string) => page.getByLabel(`Venue reassessment: ${name}`);
const checklist = (page: Page) => page.getByLabel("Outstanding before confirming").locator("li");

async function propose(baseURL: string, eventId: number, text: string): Promise<number> {
  const maya = await apiAs(baseURL, MAYA);
  const res = await maya.post(`/api/events/${eventId}/change-requests`, { data: { proposed_changes: text } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

/** Priya accepts the event's pending change request in the browser, naming the reviewed attendance. */
async function acceptInBrowser(page: Page, name: string, pax: string): Promise<void> {
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  await page.getByText("Reviewed values for reassessment (optional)", { exact: true }).click();
  await page.getByLabel("Reviewed expected attendance").fill(pax);
  await action(page, "Accept change request").click();
  await expect(result(page)).toBeVisible();
}

/** Given (API): Priya accepts the change request with these reviewed values. */
async function acceptVia(priya: APIRequestContext, eventId: number, requestId: number, changes: Record<string, unknown>): Promise<void> {
  const res = await priya.post(`/api/events/${eventId}/change-requests/${requestId}/decision`, { data: { outcome: "accepted", effective_changes: changes } });
  expect(res.status(), await res.text()).toBe(200);
}

/** Signs out with the page's Sign out button, so another person can sign in. */
async function switchUser(page: Page): Promise<void> {
  await action(page, "Sign out").click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe("US49 - Reassess Venue Bookings After an Accepted Change", () => {
  test("[US49-AC1] [US49-AC2] accepting a change re-checks the booking and flags it when it no longer fits", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Alumni Night", { attendance: 120 });
    await propose(baseURL!, ready.eventId, "We now expect 400 guests.");

    await acceptInBrowser(page, ready.name, "400");

    await expect(result(page)).toContainText("Venue bookings checked: 1.");
    await expect(result(page)).toContainText("Reassessment flags: 1.");
    await expect(coordinatorPanel(page)).toContainText("Requires Reassessment");
    await expect(coordinatorPanel(page)).toContainText("Capacity 300 is below the expected attendance of 400.");
    // The event's own details are not edited by accepting (US34).
    await expect(page.getByRole("region", { name: "Existing arrangements", exact: true })).toContainText("expected attendance 120");
    await page.reload();
    await openInQueue(page, ready.name);
    await expect(coordinatorPanel(page)).toContainText("Capacity 300 is below the expected attendance of 400.");
    observed(info, `After accepting, the reassessment panel read "${await coordinatorPanel(page).innerText()}".`);
  });

  test("[US49-AC1] a change the booking still fits flags nothing", async ({ page, baseURL }) => {
    const ready = await readyEvent(baseURL!, "Book Launch", { attendance: 120 });
    await propose(baseURL!, ready.eventId, "A few more guests: 150.");

    await acceptInBrowser(page, ready.name, "150");

    await expect(result(page)).toContainText("Venue bookings checked: 1.");
    await expect(result(page)).toContainText("Reassessment flags: 0.");
    await switchUser(page);
    await openBookings(page);
    await expect(staffPanel(page, ready.name).getByText("Requires Reassessment")).toHaveCount(0);
  });

  test("[US49-AC2] [US49-AC3] Venue Staff are told and see the booking requiring reassessment", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Orientation Day", { attendance: 120 });
    const requestId = await propose(baseURL!, ready.eventId, "Orientation now for 350 freshmen.");
    await acceptVia(ready.priya, ready.eventId, requestId, { pax: 350 });

    await openBookings(page);

    const panel = staffPanel(page, ready.name);
    await expect(panel).toContainText(`Requires reassessment: ${ready.name}`);
    await expect(panel).toContainText("Requires Reassessment");
    await expect(panel).toContainText("Capacity 300 is below the expected attendance of 350.");
    await page.getByRole("button", { name: /Notifications/ }).click();
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: ready.name }).filter({ hasText: "Booking requires reassessment" });
    await expect(notice).toContainText(`an accepted change means the ${ready.venueName} booking`);
    observed(info, `Daniel's notice: "${await notice.innerText()}".`);
  });

  test("[US49-AC4] the event can't be confirmed until the flagged booking is resolved", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Graduation Gala", { attendance: 120 });
    await sendToCheck(ready.priya, ready.eventId);
    await decideVia(await apiAs(baseURL!, HANNAH), ready.eventId, "approved");
    const requestId = await propose(baseURL!, ready.eventId, "Expecting 320 with families.");
    await acceptVia(ready.priya, ready.eventId, requestId, { pax: 320 });

    // Priya can't confirm: the flagged booking is outstanding.
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, ready.name);
    await expect(checklist(page).filter({ hasText: "Requires Reassessment — Capacity 300 is below the expected attendance of 320." })).toHaveCount(1);
    await action(page, "Confirm event").click();
    await expect(toast(page)).toContainText("Requires Reassessment");

    // Priya applies the reviewed values; Daniel finds the hall still fits (balcony seating) and resolves the flag.
    const applied = await ready.priya.post(`/api/events/${ready.eventId}/change-requests/${requestId}/apply`);
    expect(applied.status(), await applied.text()).toBe(200);
    await switchUser(page);
    await openBookings(page);
    const panel = staffPanel(page, ready.name);
    await panel.getByLabel("Resolution evidence").fill("Balcony seating opens for 40 more.");
    await panel.getByRole("button", { name: /^Resolve reassessment #\d+$/ }).click();
    await expect(panel).toContainText("Resolved: Balcony seating opens for 40 more.");

    await switchUser(page);
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, ready.name);
    await expect(checklist(page).filter({ hasText: "Requires Reassessment" })).toHaveCount(0);
    observed(info, "Confirming was refused while the booking required reassessment; once Daniel resolved it, it was no longer outstanding.");
  });
});
