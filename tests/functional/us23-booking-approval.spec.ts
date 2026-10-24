import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, submitDialog, toast, unique } from "./support/app";
import { sql } from "./support/scenario";
import { DANIEL, createVenue, eventFor, futureDate, observed, openVenueTab, type Venue } from "./support/venues";

/**
 * US23 — Approve or Reject Venue Booking (functional). Week 7 changes CR-W7-3 and CR-W7-4.
 * "As a Venue Staff member, I want to review and approve or reject a venue booking request,
 * providing a reason where relevant, so that the Event Coordinator can proceed with planning."
 *
 * "Given" steps (venues, an approved event, its booking requests) go through the API; Venue Staff
 * and the coordinator then act in the browser. Acceptance criteria: docs/user-stories/US23_booking_approval.md
 */

const REASON = "The hall is closed for maintenance that week.";

interface Requested {
  event: string;
  eventId: number;
  venue: Venue;
  bookingId: number;
}

/** Given: Priya has asked for `venue` for the event (a new approved event unless `eventId` is given). */
async function requested(baseURL: string, label: string, opts: { venue?: Venue; eventId?: number; event?: string; body?: Record<string, unknown> } = {}): Promise<Requested> {
  const venue = opts.venue ?? (await createVenue(await apiAs(baseURL, DANIEL)));
  const event = opts.event ?? unique(label);
  const eventId = opts.eventId ?? (await eventFor(baseURL, event, { date: futureDate(12), accessibility: ["Wheelchair Access"] }));
  const priya: APIRequestContext = await apiAs(baseURL, PRIYA);
  const res = await priya.post(`/api/venues/${venue.id}/booking-requests`, { data: { event_id: eventId, ...opts.body } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { event, eventId, venue, bookingId: (await res.json()).booking.id };
}

function requestCard(page: Page, r: Requested) {
  return page.getByLabel(`Booking request: ${r.event} at ${r.venue.name}`);
}

/** Switch to Priya and open her notifications. */
async function asPriya(page: Page) {
  // Leave Venue Staff's page first: a request still in flight would renew the session cookie after it was cleared.
  await page.goto("about:blank");
  await page.context().clearCookies();
  await signIn(page, PRIYA, /\/queue/);
  await page.getByRole("button", { name: /Notifications/ }).click();
}

test.describe("US23 - Approve or Reject Venue Booking", () => {
  test("[US23-AC1] [US23-AC2] Venue Staff see each pending request with its timing and venue requirements", async ({ page, baseURL }, info) => {
    const a = await requested(baseURL!, "Alumni Dinner");
    const b = await requested(baseURL!, "Pitch Night");

    await signIn(page, DANIEL, /\/bookings/);

    // Both requests, at different venues, are waiting.
    await expect(requestCard(page, a)).toBeVisible();
    await expect(requestCard(page, b)).toBeVisible();
    // The card shows when the venue is needed (with setup/teardown) and what the event needs.
    const card = requestCard(page, a);
    await expect(card.getByText(/Held from .* to .*\(30 min setup, 45 min teardown\) · 120 people/)).toBeVisible();
    await expect(card.getByText("Theatre layout")).toBeVisible();
    await expect(card.getByText("Wheelchair Access", { exact: true })).toBeVisible();
    observed(info, `Daniel saw pending requests for ${a.venue.name} and ${b.venue.name}; ${a.event}'s card showed the hold window with setup/teardown, 120 people, Theatre layout and Wheelchair Access.`);
  });

  test("[US23-AC3] a request can't be rejected without a reason", async ({ page, baseURL }) => {
    const r = await requested(baseURL!, "Science Fair");

    await signIn(page, DANIEL, /\/bookings/);
    await requestCard(page, r).getByRole("button", { name: "Reject with reason" }).click();
    await submitDialog(page, "", "Reject booking");

    await expect(toast(page)).toContainText("Give a reason for rejecting the request.");
    await expect(page.locator("textarea.textarea-input")).toBeVisible();
  });

  test("[US23-AC3] [US23-AC4] [US23-AC5] a rejection releases the venue and the coordinator is told why", async ({ page, baseURL }, info) => {
    const r = await requested(baseURL!, "Charity Gala");

    // When: Daniel rejects it with a reason.
    await signIn(page, DANIEL, /\/bookings/);
    await requestCard(page, r).getByRole("button", { name: "Reject with reason" }).click();
    await submitDialog(page, REASON, "Reject booking");
    await expect(toast(page)).toContainText(`released`);
    await expect(requestCard(page, r)).toHaveCount(0);

    // Then: Priya is told, with the reason, and sees the booking as Rejected.
    await asPriya(page);
    const notice = page.getByText(`${r.venue.name} was not approved for ${r.event}`);
    await expect(notice).toContainText(REASON);
    await page.keyboard.press("Escape");
    await openInQueue(page, r.event);
    await openVenueTab(page);
    const row = page.getByLabel(`Booking at ${r.venue.name}`);
    await expect(row.locator(".pill").first()).toHaveText("Rejected");
    await expect(row).toContainText(`Reason: ${REASON}`);
    observed(info, `After Daniel rejected it, Priya's notifications said "${await notice.innerText()}" and her Venue tab showed the booking Rejected with the reason.`);
  });

  test("[US23-AC3] [US23-AC4] [US23-AC5] an approval confirms the booking and the coordinator is told", async ({ page, baseURL }, info) => {
    const r = await requested(baseURL!, "Design Keynote");

    await signIn(page, DANIEL, /\/bookings/);
    await requestCard(page, r).getByRole("button", { name: "Approve booking" }).click();
    await expect(toast(page)).toContainText(`${r.venue.name} confirmed for ${r.event}.`);

    await asPriya(page);
    const notice = page.getByText(`${r.venue.name} is confirmed for ${r.event}`);
    await expect(notice).toBeVisible();
    await page.keyboard.press("Escape");
    await openInQueue(page, r.event);
    await openVenueTab(page);
    await expect(page.getByLabel(`Booking at ${r.venue.name}`).locator(".pill").first()).toHaveText("Approved");
    observed(info, `Priya's notifications said "${await notice.innerText()}"; her Venue tab showed ${r.venue.name} Approved.`);
  });

  test("[US23-AC6] each of an event's booking requests is decided on its own", async ({ page, baseURL }, info) => {
    // Given: one event asking for two venues (a main hall and a breakout room).
    const main = await requested(baseURL!, "Research Conference", { body: { purpose: "Main programme" } });
    const breakout = await requested(baseURL!, "", {
      eventId: main.eventId, event: main.event, body: { attendance: 40, layout: "classroom", purpose: "Breakout session" },
    });

    // When: Daniel approves the main hall only.
    await signIn(page, DANIEL, /\/bookings/);
    await requestCard(page, main).getByRole("button", { name: "Approve booking" }).click();
    await expect(toast(page)).toContainText(`${main.venue.name} confirmed`);

    // Then: the breakout room's request is still waiting for its own decision.
    await expect(requestCard(page, main)).toHaveCount(0);
    await expect(requestCard(page, breakout)).toBeVisible();
    await expect(requestCard(page, breakout)).toContainText(`This event also has: ${main.venue.name} (Main programme), approved`);
    observed(info, `After approving ${main.venue.name}, ${breakout.venue.name}'s request was still pending and noted the other booking as approved.`);
  });

  test("[US23-AC7] a hold that has expired cannot be approved", async ({ page, baseURL }, info) => {
    const r = await requested(baseURL!, "Open House");

    // Given: Daniel has the request open, then its hold expires before he decides.
    await signIn(page, DANIEL, /\/bookings/);
    await expect(requestCard(page, r)).toBeVisible();
    sql("UPDATE venue_bookings SET hold_expires_at = ? WHERE id = ?", ["2020-01-01 00:00:00.000000", r.bookingId]);

    // When: he approves it.
    await requestCard(page, r).getByRole("button", { name: "Approve booking" }).click();

    // Then: it is refused, and after a reload it is listed as an expired hold.
    await expect(toast(page)).toContainText("can't be approved");
    const refusal = await toast(page).innerText();
    await page.reload();
    await expect(requestCard(page, r)).toHaveCount(0);
    await expect(page.getByLabel(`Expired hold: ${r.event} at ${r.venue.name}`)).toBeVisible();
    observed(info, `Approving after the hold expired was refused ("${refusal.trim()}"); after a reload it was listed under Expired holds.`);
  });
});
