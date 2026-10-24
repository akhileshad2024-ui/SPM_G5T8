import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, toast, unique } from "./support/app";
import { sql } from "./support/scenario";
import { DANIEL, createVenue, eventFor, futureDate, observed, openVenueTab, type Venue } from "./support/venues";

/**
 * US42 — Expire Tentative Venue Holds (functional). Week 7 change CR-W7-4.
 * "As a Venue Staff member, I want tentative venue holds to expire at a set time so that a venue
 * is not held indefinitely while an Event Coordinator finalises arrangements."
 *
 * A pending booking request is the tentative hold. "Given" steps (a venue, an approved event, the
 * request) go through the API; letting time pass is done by moving the saved expiry into the past.
 * Acceptance criteria: docs/user-stories/US42_hold_expiry.md
 */

interface Held {
  event: string;
  venue: Venue;
  bookingId: number;
}

/** Given: Priya has requested a venue for an approved event, so the venue is tentatively held. */
async function heldVenue(baseURL: string, label: string): Promise<Held> {
  const venue = await createVenue(await apiAs(baseURL, DANIEL));
  const event = unique(label);
  const eventId = await eventFor(baseURL, event, { date: futureDate(10) });
  const res = await (await apiAs(baseURL, PRIYA)).post(`/api/venues/${venue.id}/booking-requests`, { data: { event_id: eventId } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { event, venue, bookingId: (await res.json()).booking.id };
}

/** Given: the hold's expiry has passed. */
function letExpire(bookingId: number) {
  sql("UPDATE venue_bookings SET hold_expires_at = ? WHERE id = ?", ["2020-01-01 00:00:00.000000", bookingId]);
}

/** Given: Venue Staff have set the hold to expire `hours` from now. */
async function expiresIn(staff: APIRequestContext, bookingId: number, hours: number) {
  const res = await staff.post(`/api/bookings/${bookingId}/hold`, { data: { expires_at: new Date(Date.now() + hours * 3600_000).toISOString() } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** A datetime-local value `days` from now at 18:00 Singapore time, and how the app writes it. */
function campusEvening(days: number): { input: string; shown: string } {
  const d = new Date(Date.now() + days * 24 * 3600_000 + 8 * 3600_000); // shift to campus time
  const date = d.toISOString().slice(0, 10);
  const [y, m, day] = date.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return { input: `${date}T18:00`, shown: `${day} ${month} ${y}, 18:00` };
}

function requestCard(page: Page, held: Held) {
  return page.getByLabel(`Booking request: ${held.event} at ${held.venue.name}`);
}

async function openNotifications(page: Page) {
  await page.getByRole("button", { name: /Notifications/ }).click();
}

test.describe("US42 - Expire Tentative Venue Holds", () => {
  test("[US42-AC1] a new request is held until a default expiry, shown to Venue Staff", async ({ page, baseURL }, info) => {
    const held = await heldVenue(baseURL!, "Alumni Gala");

    await signIn(page, DANIEL, /\/bookings/);

    const card = requestCard(page, held);
    await expect(card.getByText(/^Held until \d{2} \w{3} \d{4}, \d{2}:\d{2} · default/)).toBeVisible();
    observed(info, `The pending request for ${held.event} at ${held.venue.name} showed "${await card.getByText(/^Held until/).innerText()}".`);
  });

  test("[US42-AC1] Venue Staff set when the hold expires, and it is kept", async ({ page, baseURL }, info) => {
    const held = await heldVenue(baseURL!, "Design Showcase");
    const when = campusEvening(2);

    // When: Daniel sets the hold to expire in two days at 18:00.
    await signIn(page, DANIEL, /\/bookings/);
    const card = requestCard(page, held);
    await card.getByLabel("Hold expires").fill(when.input);
    await card.getByRole("button", { name: "Set hold expiry" }).click();

    // Then: it is saved with who set it, and still there after a reload.
    await expect(toast(page)).toContainText("until the new expiry");
    await page.reload();
    await expect(requestCard(page, held).getByText(`Held until ${when.shown} · set by ${DANIEL.email}`)).toBeVisible();
    observed(info, `After setting ${when.input} (campus time) and reloading, the card showed "Held until ${when.shown} · set by ${DANIEL.email}".`);
  });

  test("[US42-AC1] a hold cannot be set to last beyond the start of setup", async ({ page, baseURL }) => {
    const held = await heldVenue(baseURL!, "Science Fair");

    await signIn(page, DANIEL, /\/bookings/);
    const card = requestCard(page, held);
    await card.getByLabel("Hold expires").fill(campusEvening(20).input); // the event is in 10 days
    await card.getByRole("button", { name: "Set hold expiry" }).click();

    await expect(toast(page)).toContainText("The hold can't last beyond the start of setup for the event.");
  });

  test("[US42-AC2] [US42-AC4] an expired hold leaves the pending list and is shown as Expired", async ({ page, baseURL }, info) => {
    // Given: a request whose hold has expired without being approved.
    const held = await heldVenue(baseURL!, "Charity Gala");
    letExpire(held.bookingId);

    // When: Daniel opens Booking requests.
    await signIn(page, DANIEL, /\/bookings/);

    // Then: there is nothing to approve, and it is listed as an expired hold with its venue released.
    await expect(requestCard(page, held)).toHaveCount(0);
    const expired = page.getByLabel(`Expired hold: ${held.event} at ${held.venue.name}`);
    await expect(expired.locator(".pill")).toHaveText("Expired");
    await expect(expired).toContainText("the venue has been released");
    observed(info, `${held.event} was not among the pending requests; the Expired holds section showed it as "Expired" with the venue released.`);
  });

  test("[US42-AC4] the coordinator sees the booking as Expired, not confirmed", async ({ page, baseURL }) => {
    const held = await heldVenue(baseURL!, "Pitch Night");
    letExpire(held.bookingId);

    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, held.event);
    await openVenueTab(page);

    const row = page.getByLabel(`Booking at ${held.venue.name}`);
    await expect(row.locator(".pill").first()).toHaveText("Expired");
    await expect(row).toContainText("the venue has been released");
  });

  test("[US42-AC3] the coordinator is warned when a hold is about to expire", async ({ page, baseURL }, info) => {
    const held = await heldVenue(baseURL!, "Open House");
    await expiresIn(await apiAs(baseURL!, DANIEL), held.bookingId, 5);

    await signIn(page, PRIYA, /\/queue/);
    await openNotifications(page);

    const notice = page.getByText(`${held.venue.name} for ${held.event} is held until`);
    await expect(page.getByText("Venue hold expiring soon").first()).toBeVisible();
    await expect(notice).toBeVisible();
    observed(info, `Priya's notifications included "Venue hold expiring soon": "${await notice.innerText()}".`);
  });

  test("[US42-AC3] the coordinator is told again when the hold expires", async ({ page, baseURL }, info) => {
    const held = await heldVenue(baseURL!, "Career Fair");
    letExpire(held.bookingId);

    await signIn(page, PRIYA, /\/queue/);
    await openNotifications(page);

    const notice = page.getByText(`${held.venue.name} for ${held.event} expired on`);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("has been released");
    observed(info, `Priya's notifications included "Venue hold expired": "${await notice.innerText()}".`);
  });
});
