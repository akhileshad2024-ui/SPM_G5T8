import { expect, test } from "@playwright/test";
import { PRIYA, apiAs, submitDialog, toast, unique } from "./support/app";
import { approveInCard, bookingsBy, openBookings, openCatalogue, pill, requestCard, requestVenue } from "./support/bookings";
import { DANIEL, catalogueCard, createVenue, dateLabel, eventFor, futureDate, observed, updateVenue } from "./support/venues";

/**
 * US47 — Flag Conflicting Pending Requests (functional).
 * "As a Venue Staff member, I want pending booking requests that conflict with one another to be
 * flagged so that I can decide which one to approve."
 *
 * A second pending request for the same venue and time is refused when it is made (US22 AC5), so two
 * pending requests only end up in conflict after a venue's setup or turnaround time changes (US38).
 * The tests make them conflict that way.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const MANUAL = "Needs manual resolution";

interface PairOptions {
  setupMinutes: number;
  turnaroundMinutes: number;
  houseStart: string;
  houseEnd: string;
}

/**
 * Given: a venue, and two pending requests: Career Fair 10:00-12:00 and Open House (12:30-14:00 unless given).
 * With no setup or turnaround time (the default) they clear each other.
 */
async function twoPendingRequests(baseURL: string, date: string, options: Partial<PairOptions> = {}) {
  const { setupMinutes = 0, turnaroundMinutes = 0, houseStart = "12:30", houseEnd = "14:00" } = options;
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const venue = await createVenue(staff, { name: unique("Conflict Hall"), cap: 300, layouts: ["theatre"], setupMinutes, turnaroundMinutes });
  const fair = unique("Career Fair");
  const house = unique("Open House");
  await requestVenue(priya, venue.id, await eventFor(baseURL, fair, { date, start: "10:00", end: "12:00" }));
  await requestVenue(priya, venue.id, await eventFor(baseURL, house, { date, start: houseStart, end: houseEnd }));
  return { staff, venue, fair, house };
}

test.describe("US47 - Flag Conflicting Pending Requests", () => {
  test("[TC-US47-01] [US47-AC1] pending requests that conflict with one another are flagged for manual resolution", async ({ page, baseURL }, info) => {
    const date = futureDate(75);
    const { venue, fair, house } = await twoPendingRequests(baseURL!, date);
    await openBookings(page);
    await expect(requestCard(page, fair, venue.name)).toBeVisible();
    await expect(pill(requestCard(page, fair, venue.name), MANUAL)).toHaveCount(0); // they clear each other for now

    // Venue Staff give the venue a 60 minute setup time: Career Fair is held 09:00-12:00, Open House 11:30-14:00.
    await openCatalogue(page);
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Setup minutes").fill("60");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated. 2 bookings flagged to coordinators.`);
    await page.goto("/bookings");

    await expect(page.getByText(/\d+ pending requests? conflicts? with another pending request\./)).toBeVisible();
    for (const [name, other, window] of [[fair, house, "12:30–14:00"], [house, fair, "10:00–12:00"]] as const) {
      const card = requestCard(page, name, venue.name);
      const manual = card.locator(".callout", { hasText: "This request conflicts with another pending request." });
      await expect(pill(card, MANUAL)).toBeVisible();
      await expect(manual).toBeVisible();
      await expect(manual.getByText(`${other} · ${date}, ${window} · Pending booking`)).toBeVisible();
    }
    const manualForFair = requestCard(page, fair, venue.name).locator(".callout", { hasText: "This request conflicts with another pending request." });
    await expect(manualForFair.getByText(`Clashes with ${house}, already requested on ${dateLabel(date)} (venue occupied 11:30–14:00 incl. 60 min setup).`)).toBeVisible();
    observed(info, `After the venue's setup time went from 0 to 60 min ("${venue.name} updated. 2 bookings flagged to coordinators."), the Booking requests page showed "N pending requests conflict with another pending request." and each of the two requests carried the "${MANUAL}" tag and "This request conflicts with another pending request.", naming the other request with its date, time and status.`);
  });

  test("[TC-US47-02] [US47-AC1] nothing is decided for Venue Staff: they approve one, and the other can then only be rejected", async ({ page, baseURL }, info) => {
    const date = futureDate(76);
    const { staff, venue, fair, house } = await twoPendingRequests(baseURL!, date);
    await updateVenue(staff, venue.id, { setupMinutes: 60 });
    const before = await bookingsBy(staff);
    expect([before[fair].status, before[house].status]).toEqual(["pending", "pending"]); // the flag decided nothing
    await openBookings(page);
    const fairCard = requestCard(page, fair, venue.name);
    const houseCard = requestCard(page, house, venue.name);
    await expect(pill(houseCard, MANUAL)).toBeVisible();

    await approveInCard(fairCard);
    await expect(toast(page)).toContainText(`${venue.name} confirmed for ${fair}.`);

    // Open House is now in the way of a confirmed booking: it can't be approved, and it is no longer a choice between two.
    await expect(houseCard.getByText("Can't be approved while this stands.")).toBeVisible();
    await expect(pill(houseCard, MANUAL)).toHaveCount(0);
    await approveInCard(houseCard);
    await expect(toast(page)).toContainText(`Can't approve: Clashes with ${fair}, already booked`);
    await houseCard.getByRole("button", { name: "Reject with reason" }).click();
    await submitDialog(page, "The Career Fair has the hall.", "Reject booking");
    await expect(toast(page)).toContainText("Booking rejected.");

    const after = await bookingsBy(staff);
    expect([after[fair].status, after[fair].conflicts.length]).toEqual(["approved", 0]);
    observed(info, `Both requests were still pending after being flagged. Approving ${fair} showed "${venue.name} confirmed for ${fair}."; ${house} then showed "Can't be approved while this stands." and lost its "${MANUAL}" tag. Approving it was refused ("Can't approve: Clashes with ${fair}, already booked ..."), rejecting it with a reason worked, and ${fair} was left confirmed with nothing in its way.`);
  });

  test("[TC-US47-03] [US47-AC1] requests that only touch are not flagged", async ({ page, baseURL }, info) => {
    const date = futureDate(77);
    // With the venue's 30 min setup and 45 min turnaround, Career Fair (10:00-12:00) is held until 12:45 and Open House (13:15-15:00) from 12:45.
    const { venue, fair, house } = await twoPendingRequests(baseURL!, date, { setupMinutes: 30, turnaroundMinutes: 45, houseStart: "13:15", houseEnd: "15:00" });
    await openBookings(page);

    for (const name of [fair, house]) {
      const card = requestCard(page, name, venue.name);
      await expect(card).toBeVisible();
      await expect(pill(card, MANUAL)).toHaveCount(0);
      await expect(card.getByText("conflicts with another pending request")).toHaveCount(0);
    }
    observed(info, `${fair} (10:00-12:00) and ${house} (13:15-15:00) at a venue with 30 min setup and 45 min turnaround were both listed without the "${MANUAL}" tag.`);
  });
});
