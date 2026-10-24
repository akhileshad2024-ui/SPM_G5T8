import { expect, test } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, submitDialog, toast, unique } from "./support/app";
import { bookingsBy, confirmVia, openBookings, openCatalogue, pill, reassessmentCard, requestCard, requestVenue } from "./support/bookings";
import { DANIEL, catalogueCard, createVenue, dateLabel, eventFor, futureDate, observed, openVenueTab, updateVenue } from "./support/venues";

/**
 * US38 — Flag Bookings Affected by Venue Time Changes (functional).
 * "As a Venue Staff member, I want existing bookings re-checked when a venue's setup or turnaround time
 * changes so that bookings that now clash are identified rather than silently removed."
 *
 * AC4 (the coordinator is notified): there is no stored notification until US36, so the flag is saved on the
 * booking and the coordinator's page turns it into a notification when it loads. That is what is tested.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const REASSESS = "Requires Reassessment";

/**
 * Given: a venue with no setup or turnaround time, and two bookings that clear each other: Career Fair 10:00-12:00
 * and Open House 12:30-14:00 (pending, or confirmed by Venue Staff when `confirm` is set).
 */
async function adjacentBookings(baseURL: string, date: string, confirm = false) {
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const venue = await createVenue(staff, { name: unique("Timed Hall"), cap: 300, layouts: ["theatre"], setupMinutes: 0, turnaroundMinutes: 0 });
  const fair = unique("Career Fair");
  const house = unique("Open House");
  const fairId = await eventFor(baseURL, fair, { date, start: "10:00", end: "12:00" });
  const houseId = await eventFor(baseURL, house, { date, start: "12:30", end: "14:00" });
  const fairBooking = await requestVenue(priya, venue.id, fairId);
  const houseBooking = await requestVenue(priya, venue.id, houseId);
  if (confirm) {
    await confirmVia(staff, fairBooking.id);
    await confirmVia(staff, houseBooking.id);
  }
  return { staff, priya, venue, fair, house, fairId, houseId };
}

test.describe("US38 - Flag Bookings Affected by Venue Time Changes", () => {
  test("[TC-US38-01] [US38-AC1] [US38-AC2] changing a venue's setup time flags the bookings that now overlap, listed with the booking they clash with", async ({ page, baseURL }, info) => {
    const date = futureDate(85);
    const { venue, fair, house } = await adjacentBookings(baseURL!, date);
    await openBookings(page);
    await expect(requestCard(page, fair, venue.name)).toBeVisible();
    await expect(reassessmentCard(page, fair, venue.name)).toHaveCount(0); // nothing overlaps yet

    await openCatalogue(page);
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Setup minutes").fill("60");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated. 2 bookings flagged to coordinators.`);
    await page.goto("/bookings");

    await expect(page.getByText("Bookings requiring reassessment")).toBeVisible();
    for (const [name, other, window] of [[fair, house, "11:30–14:00"], [house, fair, "09:00–12:00"]] as const) {
      const entry = reassessmentCard(page, name, venue.name);
      await expect(entry).toBeVisible();
      await expect(pill(entry, REASSESS)).toBeVisible();
      await expect(entry.getByText(`${venue.name}'s setup and turnaround time changed (now 60 min setup and 0 min turnaround) and this booking now overlaps another booking at the venue.`)).toBeVisible();
      await expect(entry.getByText(`Clashes with ${other}, already requested on ${dateLabel(date)} (venue occupied ${window} incl. 60 min setup).`)).toBeVisible();
    }
    observed(info, `Raising ${venue.name}'s setup time from 0 to 60 min showed "${venue.name} updated. 2 bookings flagged to coordinators." The Booking requests page then listed ${fair} and ${house} under "Bookings requiring reassessment", each tagged "${REASSESS}", saying the setup and turnaround time changed (now 60 min setup and 0 min turnaround), and naming the other booking it clashes with (${house} held 11:30–14:00, ${fair} held 09:00–12:00).`);
  });

  test("[TC-US38-02] [US38-AC1] only the bookings that now overlap are flagged, and every booking's hold follows the venue's new time", async ({ page, baseURL }, info) => {
    const date = futureDate(86);
    const { staff, priya, venue, fair } = await adjacentBookings(baseURL!, date);
    const evening = unique("Evening Talk");
    await requestVenue(priya, venue.id, await eventFor(baseURL!, evening, { date, start: "18:00", end: "19:00" })); // clears both, even with a 60 min setup

    await updateVenue(staff, venue.id, { setupMinutes: 60 });
    await openBookings(page);

    const card = requestCard(page, evening, venue.name);
    await expect(card).toBeVisible();
    await expect(pill(card, REASSESS)).toHaveCount(0);
    await expect(reassessmentCard(page, evening, venue.name)).toHaveCount(0);
    await expect(card.getByText("(60 min setup, 0 min teardown)")).toBeVisible(); // re-checked: its hold follows the new setup time
    await expect(pill(requestCard(page, fair, venue.name), REASSESS)).toBeVisible();
    expect((await bookingsBy(staff))[evening].setup_minutes).toBe(60);
    observed(info, `After the setup time went from 0 to 60 min, ${fair} was tagged "${REASSESS}" but ${evening} (18:00-19:00, clear of both) was not. Its request showed "Held from ... (60 min setup, 0 min teardown)", so its hold had been brought into line with the venue's new time.`);
  });

  test("[TC-US38-03] [US38-AC3] a flagged booking is never removed or cancelled automatically, and the event is unchanged", async ({ page, baseURL }, info) => {
    const date = futureDate(87);
    const { staff, priya, venue, fair, house, fairId } = await adjacentBookings(baseURL!, date, true);
    const before = await (await priya.get(`/api/events/${fairId}`)).json();

    await updateVenue(staff, venue.id, { setupMinutes: 60 });

    const after = await bookingsBy(priya);
    expect([after[fair].status, after[house].status]).toEqual(["approved", "approved"]); // still confirmed
    expect(after[fair].reassessment).not.toBeNull();
    const eventAfter = await (await priya.get(`/api/events/${fairId}`)).json();
    for (const field of ["status", "name", "date", "start", "end", "venue", "bookingState", "pax", "layout"]) {
      expect(eventAfter[field], field).toEqual(before[field]);
    }
    await openBookings(page);
    const entry = reassessmentCard(page, fair, venue.name);
    await expect(entry).toBeVisible();
    await expect(entry.getByText("Confirmed", { exact: true })).toBeVisible();
    observed(info, `${fair} and ${house}, both confirmed, were flagged when the venue's setup time went to 60 min and both stayed "approved". ${fair}'s event kept its status, name, date, times, venue, booking state, attendance and layout. The Booking requests page listed it under "Bookings requiring reassessment" as Confirmed.`);
  });

  test("[TC-US38-04] [US38-AC4] the event's coordinator is notified of the flagged booking", async ({ page, baseURL }, info) => {
    const date = futureDate(88);
    const { staff, venue, fair, house } = await adjacentBookings(baseURL!, date);
    await updateVenue(staff, venue.id, { setupMinutes: 60 });

    await signIn(page, PRIYA, /\/queue/);
    const bell = page.getByRole("button", { name: /Notifications/ });
    await bell.click();
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: fair });
    await expect(notice).toContainText("Booking requires reassessment");
    await expect(notice).toContainText("setup and turnaround time changed (now 60 min setup and 0 min turnaround)");
    await expect(notice).not.toContainText(house); // the other booking is another event's: the coordinator isn't told which
    await bell.click();

    await openInQueue(page, fair);
    await openVenueTab(page);
    await expect(page.getByLabel(`Booking at ${venue.name}`)).toContainText(`${REASSESS}.`);
    observed(info, `Signed in as Priya, Notifications held "Booking requires reassessment" for ${fair}, saying the venue's setup and turnaround time changed (now 60 min setup and 0 min turnaround), without naming ${house}. The event's Venue tab showed "${REASSESS}." on its booking at ${venue.name}.`);
  });

  test("[TC-US38-05] [US38-AC2] a flag goes once the booking it clashed with is rejected", async ({ page, baseURL }, info) => {
    const date = futureDate(89);
    const { staff, priya, venue, fair, house } = await adjacentBookings(baseURL!, date);
    await updateVenue(staff, venue.id, { setupMinutes: 60 });
    await openBookings(page);
    await expect(reassessmentCard(page, fair, venue.name)).toBeVisible();

    await requestCard(page, house, venue.name).getByRole("button", { name: "Reject with reason" }).click();
    await submitDialog(page, "The hall is needed for the Career Fair.", "Reject booking");
    await expect(toast(page)).toContainText("Booking rejected.");

    // Without a reload: the rejected request leaves the list, and the booking it clashed with is no longer flagged.
    await expect(requestCard(page, house, venue.name)).toHaveCount(0);
    await expect(requestCard(page, fair, venue.name)).toBeVisible();
    await expect(reassessmentCard(page, fair, venue.name)).toHaveCount(0);
    await expect(pill(requestCard(page, fair, venue.name), REASSESS)).toHaveCount(0);
    expect((await bookingsBy(priya))[fair].reassessment).toBeNull();
    observed(info, `Rejecting ${house} with a reason took it off the list and removed ${fair} from "Bookings requiring reassessment" without reloading the page: nothing clashed with it any more, and its saved booking no longer carried the flag.`);
  });

  test("[TC-US38-06] [US38-AC2] a flag goes once the venue's time is put back", async ({ page, baseURL }, info) => {
    const date = futureDate(90);
    const { staff, priya, venue, fair, house } = await adjacentBookings(baseURL!, date);
    await updateVenue(staff, venue.id, { setupMinutes: 60 });
    await openBookings(page);
    await expect(reassessmentCard(page, fair, venue.name)).toBeVisible();
    await expect(reassessmentCard(page, house, venue.name)).toBeVisible();

    await openCatalogue(page);
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Setup minutes").fill("0");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);
    await page.goto("/bookings");

    await expect(requestCard(page, fair, venue.name)).toBeVisible();
    await expect(reassessmentCard(page, fair, venue.name)).toHaveCount(0);
    await expect(reassessmentCard(page, house, venue.name)).toHaveCount(0);
    const saved = await bookingsBy(priya);
    expect([saved[fair].reassessment, saved[house].reassessment]).toEqual([null, null]);
    observed(info, `Setting ${venue.name}'s setup time back to 0 min removed both bookings from "Bookings requiring reassessment" and cleared the flag on both saved bookings.`);
  });
});
