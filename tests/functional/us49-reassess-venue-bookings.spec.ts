import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { HANNAH, MAYA, PRIYA, action, apiAs, openInQueue, signIn, toast } from "./support/app";
import { openBookings, reassessmentCard } from "./support/bookings";
import { decideVia, readyEvent, sendToCheck } from "./support/safety";
import { DANIEL, observed } from "./support/venues";

/**
 * US49 — Reassess Venue Bookings After an Accepted Change (functional). Split from US35; Week 7 change CR-W7-3.
 * "As an Event Coordinator, I want the event's venue bookings to be re-evaluated and flagged for reassessment
 * when a change is accepted so that venue information remains consistent."
 *
 * "Given" steps (an approved event of 120 people booked into a 300-seat hall, Maya's change request) go through
 * the API; Priya accepts the change and Daniel (Venue Staff) reassesses the booking in the browser.
 * Acceptance criteria: docs/user-stories/US49_reassess_venue_bookings.md
 */

const changeRequests = (page: Page) => page.getByRole("region", { name: "Change requests", exact: true });
const checklist = (page: Page) => page.getByLabel("Outstanding before confirming").locator("li");

async function propose(baseURL: string, eventId: number, text: string): Promise<void> {
  const maya = await apiAs(baseURL, MAYA);
  const res = await maya.post(`/api/events/${eventId}/change-requests`, { data: { proposed_changes: text } });
  expect(res.status(), await res.text()).toBe(201);
}

/** Priya accepts the event's pending change request in the browser, naming the new attendance. */
async function acceptInBrowser(page: Page, name: string, pax: string): Promise<void> {
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  await changeRequests(page).getByLabel("New expected attendance").fill(pax);
  await changeRequests(page).getByRole("button", { name: "Accept change request", exact: true }).click();
  await expect(changeRequests(page)).toContainText("· accepted");
}

/** Signs out with the page's Sign out button, so another person can sign in. */
async function switchUser(page: Page): Promise<void> {
  await action(page, "Sign out").click();
  await expect(page).toHaveURL(/\/login/);
}

/** Given (API): Priya accepts the change request, naming what it changes. */
async function acceptVia(priya: APIRequestContext, eventId: number, changes: Record<string, unknown>): Promise<void> {
  const [request] = await (await priya.get(`/api/events/${eventId}/change-requests`)).json();
  const res = await priya.post(`/api/events/${eventId}/change-requests/${request.id}/decision`, { data: { outcome: "accepted", changes } });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe("US49 - Reassess Venue Bookings After an Accepted Change", () => {
  test("[US49-AC1] [US49-AC2] accepting a change re-checks the booking and flags it when it no longer fits", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Alumni Night", { attendance: 120 });
    await propose(baseURL!, ready.eventId, "We now expect 400 guests.");

    await acceptInBrowser(page, ready.name, "400");

    const recheck = page.getByLabel(/Venue re-check for request #\d+/);
    await expect(recheck).toContainText("Changes: expected attendance 400. 1 venue booking re-checked: 1 requires reassessment.");
    await expect(recheck).toContainText(`${ready.venueName}`);
    await expect(recheck).toContainText("Requires Reassessment. Capacity 300 is below the expected attendance of 400.");
    // The event's own details are not edited by accepting (US34).
    await expect(page.getByRole("region", { name: "Existing arrangements", exact: true })).toContainText("expected attendance 120");
    await page.reload();
    await openInQueue(page, ready.name);
    await expect(page.getByLabel(/Venue re-check for request #\d+/)).toContainText("1 requires reassessment.");
    observed(info, `After accepting, the request read "${await page.getByLabel(/Venue re-check/).innerText()}".`);
  });

  test("[US49-AC1] a change the booking still fits flags nothing", async ({ page, baseURL }) => {
    const ready = await readyEvent(baseURL!, "Book Launch", { attendance: 120 });
    await propose(baseURL!, ready.eventId, "A few more guests: 150.");

    await acceptInBrowser(page, ready.name, "150");

    await expect(page.getByLabel(/Venue re-check for request #\d+/)).toContainText("1 venue booking re-checked: all still fit.");
    await switchUser(page);
    await openBookings(page);
    await expect(reassessmentCard(page, ready.name, ready.venueName)).toHaveCount(0);
  });

  test("[US49-AC2] [US49-AC3] Venue Staff are told and see the booking requiring reassessment", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Orientation Day", { attendance: 120 });
    await propose(baseURL!, ready.eventId, "Orientation now for 350 freshmen.");
    await acceptVia(ready.priya, ready.eventId, { pax: 350 });

    await openBookings(page);

    const card = reassessmentCard(page, ready.name, ready.venueName);
    await expect(card).toContainText("Requires Reassessment");
    await expect(card.getByLabel("Why it no longer fits")).toHaveText("Capacity 300 is below the expected attendance of 350.");
    await page.getByRole("button", { name: /Notifications/ }).click();
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: ready.name }).filter({ hasText: "Booking requires reassessment" });
    await expect(notice).toContainText(`an accepted change means the ${ready.venueName} booking`);
    observed(info, `Daniel's notice: "${await notice.innerText()}".`);
  });

  test("[US49-AC4] the event can't be confirmed until Venue Staff reassess the flagged booking", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Graduation Gala", { attendance: 120 });
    await sendToCheck(ready.priya, ready.eventId);
    await decideVia(await apiAs(baseURL!, HANNAH), ready.eventId, "approved");
    await propose(baseURL!, ready.eventId, "Expecting 320 with families.");
    await acceptVia(ready.priya, ready.eventId, { pax: 320 });

    // Priya can't confirm: the flagged booking is outstanding.
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, ready.name);
    await expect(checklist(page)).toHaveText([new RegExp(`The booking at ${ready.venueName} requires reassessment after change request #\\d+: Capacity 300 is below the expected attendance of 320\\.`)]);
    await action(page, "Confirm event").click();
    await expect(toast(page)).toContainText("requires reassessment");

    // Daniel reassesses it: the balcony takes the extra guests.
    await switchUser(page);
    await openBookings(page);
    const card = reassessmentCard(page, ready.name, ready.venueName);
    await card.getByLabel(/If the booking still fits after the change/).fill("Balcony seating opens for 40 more.");
    await card.getByRole("button", { name: "Mark still valid", exact: true }).click();
    await expect(toast(page)).toContainText(`${ready.venueName} still fits ${ready.name}.`);
    await expect(card).toHaveCount(0);

    await switchUser(page);
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, ready.name);
    await expect(page.getByLabel("Confirmation")).toContainText("is ready to confirm");
    await expect(page.getByLabel(/Venue re-check for request #\d+/)).toContainText(`Still fits, reassessed by ${DANIEL.name}: Balcony seating opens for 40 more.`);
    await action(page, "Confirm event").click();
    await expect(toast(page)).toContainText(`${ready.name} confirmed.`);
    observed(info, "Confirming was refused while the booking required reassessment, and succeeded once Daniel marked it still valid.");
  });
});
