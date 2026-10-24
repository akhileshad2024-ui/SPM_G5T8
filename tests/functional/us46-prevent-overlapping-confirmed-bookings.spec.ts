import { expect, test, type APIRequestContext } from "@playwright/test";
import { PRIYA, apiAs, toast, unique } from "./support/app";
import { approveInCard, bookingsBy, confirmVia, openBookings, requestCard, requestVenue } from "./support/bookings";
import { DANIEL, createVenue, dateLabel, eventFor, futureDate, observed, updateVenue, type Venue, type VenueFields } from "./support/venues";

/**
 * US46 — Prevent Overlapping Confirmed Bookings (functional).
 * "As a Venue Staff member, I want the system to prevent a booking from being confirmed when it
 * overlaps a confirmed booking for the same venue so that a venue is not double-booked."
 *
 * The backlog's test case: an event from 10:00 to 12:00 at a venue with 30 minutes setup and 45
 * minutes turnaround occupies the venue from 09:30 to 12:45.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const GALA_WINDOW = "09:30–12:45 incl. 30 min setup and 45 min turnaround";

/** Given: a venue (30 min setup, 45 min turnaround) and Gala, a 10:00-12:00 event whose booking Venue Staff have confirmed. */
async function venueWithConfirmedGala(baseURL: string, date: string, fields: Partial<VenueFields> = {}) {
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const venue = await createVenue(staff, { name: unique("Overlap Hall"), cap: 300, layouts: ["theatre"], setupMinutes: 30, turnaroundMinutes: 45, ...fields });
  const gala = unique("Gala");
  const booking = await requestVenue(priya, venue.id, await eventFor(baseURL, gala, { date, start: "10:00", end: "12:00" }));
  await confirmVia(staff, booking.id);
  return { staff, priya, venue, gala };
}

/** Given: an approved event from `start` to `end` that asks for the venue. */
async function requestFair(baseURL: string, priya: APIRequestContext, venue: Venue, name: string, date: string, start: string, end: string, acknowledged = false) {
  return requestVenue(priya, venue.id, await eventFor(baseURL, name, { date, start, end }), acknowledged);
}

test.describe("US46 - Prevent Overlapping Confirmed Bookings", () => {
  test("[TC-US46-01] [US46-AC1] [US46-AC3] a booking that overlaps a confirmed booking can't be confirmed and the conflicting booking's details are shown", async ({ page, baseURL }, info) => {
    const date = futureDate(70);
    const { staff, priya, venue, gala } = await venueWithConfirmedGala(baseURL!, date);
    const fair = unique("Fair");
    await requestFair(baseURL!, priya, venue, fair, date, "11:00", "13:00", true); // unsuitable while Gala holds the venue: acknowledged
    await openBookings(page);
    const card = requestCard(page, fair, venue.name);

    const clash = `Clashes with ${gala}, already booked on ${dateLabel(date)} (venue occupied ${GALA_WINDOW}).`;
    // The same clash is also in the override the coordinator acknowledged when asking, so read the warning that stops approval.
    const stopping = card.locator(".callout", { hasText: "Can't be approved while this stands." });
    await expect(stopping).toBeVisible();
    await expect(stopping.getByText(clash)).toBeVisible();
    await expect(stopping.getByText(`${gala} · ${date}, 10:00–12:00 · Confirmed booking`)).toBeVisible();

    await approveInCard(card);
    await expect(toast(page)).toContainText(`Can't approve: ${clash}`);
    expect((await bookingsBy(staff))[fair].status).toBe("pending");
    observed(info, `Fair's request (11:00-13:00) showed "Can't be approved while this stands." with "${clash}" and the line "${gala} · ${date}, 10:00–12:00 · Confirmed booking". Pressing Approve booking showed "Can't approve: ${clash}" and the booking stayed pending.`);
  });

  test("[TC-US46-02] [US46-AC2] the venue's setup and turnaround count around both bookings: touching windows are confirmed, one minute more is refused", async ({ page, baseURL }, info) => {
    const date = futureDate(71);
    const { priya, venue, gala } = await venueWithConfirmedGala(baseURL!, date); // Gala occupies the venue until 12:45
    const touching = unique("Touching Fair");
    await requestFair(baseURL!, priya, venue, touching, date, "13:15", "15:00"); // its setup starts at 12:45
    await openBookings(page);

    await approveInCard(requestCard(page, touching, venue.name));
    await expect(toast(page)).toContainText(`${venue.name} confirmed for ${touching}.`);

    const overlapping = unique("Overlapping Fair");
    await requestFair(baseURL!, priya, venue, overlapping, date, "13:14", "15:00", true); // setup starts at 12:44, one minute too early
    await page.reload();
    await approveInCard(requestCard(page, overlapping, venue.name));
    await expect(toast(page)).toContainText("Can't approve:");
    await expect(toast(page)).toContainText(`Clashes with ${gala}, already booked on ${dateLabel(date)}`);
    await expect(toast(page)).toContainText(`Clashes with ${touching}, already booked on ${dateLabel(date)}`);
    observed(info, `A booking whose setup starts at 12:45, exactly when Gala's turnaround ends, was confirmed ("${venue.name} confirmed for ${touching}."). One that starts 13:14 (setup from 12:44) was refused, naming both Gala and ${touching}.`);
  });

  test("[TC-US46-03] [US46-AC4] the check is made again when the booking is confirmed, not only when it was requested", async ({ page, baseURL }, info) => {
    const date = futureDate(72);
    const { staff, priya, venue, gala } = await venueWithConfirmedGala(baseURL!, date, { setupMinutes: 0, turnaroundMinutes: 0 });
    const fair = unique("Fair");
    await requestFair(baseURL!, priya, venue, fair, date, "12:30", "14:00"); // clear of Gala while the venue has no setup or turnaround
    await openBookings(page);
    const card = requestCard(page, fair, venue.name);
    await expect(card).toBeVisible();
    await expect(card.getByText("Can't be approved while this stands.")).toHaveCount(0);

    await updateVenue(staff, venue.id, { setupMinutes: 45 }); // changed behind this page's back

    await approveInCard(card);
    await expect(toast(page)).toContainText("Can't approve:");
    await expect(toast(page)).toContainText(`Clashes with ${gala}, already booked on ${dateLabel(date)} (venue occupied 09:15–12:00 incl. 45 min setup).`);
    await expect(card.getByText("Can't be approved while this stands.")).toBeVisible(); // the card has caught up
    observed(info, `Fair (12:30-14:00) was clear when it was requested and looked approvable. After the venue's setup time was raised to 45 min from another session, Approve booking was refused ("Clashes with ${gala}, already booked ... (venue occupied 09:15–12:00 incl. 45 min setup)") and the card then showed "Can't be approved while this stands."`);
  });
});
