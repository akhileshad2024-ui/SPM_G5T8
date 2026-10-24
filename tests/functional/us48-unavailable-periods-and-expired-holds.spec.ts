import { expect, test, type Page } from "@playwright/test";
import { PRIYA, apiAs, toast, unique } from "./support/app";
import { approveInCard, openBookings, openCatalogue, requestCard, requestVenue } from "./support/bookings";
import { DANIEL, catalogueCard, createVenue, dateLabel, eventFor, futureDate, observed, updateVenue } from "./support/venues";

/**
 * US48 — Include Unavailable Periods and Expired Holds in Conflict Checks (functional).
 * "As a Venue Staff member, I want the conflict check to account for venue unavailable periods and
 * expired holds so that availability reflects the venue's real situation."
 *
 * AC1 (an unavailable period is a conflict, the same as a confirmed booking) is tested here.
 * AC2 (expired tentative holds are left out) depends on US42, which is not built: nothing in the app
 * sets a hold's expiry time, so an expired hold can't be made through the app. It is covered by the
 * unit and integration tests, and recorded as Blocked in the test cases.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */

/** Given: a venue (30 min setup, 45 min turnaround) and a pending request for a 10:00-12:00 event on `date`. */
async function pendingRequest(baseURL: string, date: string, label: string) {
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const venue = await createVenue(staff, { name: unique("Period Hall"), cap: 300, layouts: ["theatre"], setupMinutes: 30, turnaroundMinutes: 45 });
  const event = unique(label);
  await requestVenue(priya, venue.id, await eventFor(baseURL, event, { date, start: "10:00", end: "12:00" }));
  return { staff, venue, event };
}

/** In the open venue form: add an unavailable period. */
async function addPeriod(page: Page, start: string, end: string, reason: string, note = "") {
  await page.getByRole("button", { name: "+ Add unavailable period" }).click();
  await page.getByLabel("Unavailable from").last().fill(start);
  await page.getByLabel("Unavailable until").last().fill(end);
  await page.getByLabel("Reason").last().selectOption({ label: reason });
  if (note) await page.getByLabel("Note").last().fill(note);
}

test.describe("US48 - Include Unavailable Periods and Expired Holds in Conflict Checks", () => {
  test("[TC-US48-01] [US48-AC1] an unavailable period over a pending booking is shown as a conflict and stops it being confirmed, like a confirmed booking", async ({ page, baseURL }, info) => {
    const date = futureDate(80);
    const { staff, venue, event } = await pendingRequest(baseURL!, date, "Period Fair");
    await openBookings(page);
    await expect(requestCard(page, event, venue.name).getByText("Can't be approved while this stands.")).toHaveCount(0);

    await openCatalogue(page);
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await addPeriod(page, `${date}T08:00`, `${date}T20:00`, "Maintenance", "Floor repairs");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated. 1 booking flagged to coordinators.`);
    await page.goto("/bookings");

    const card = requestCard(page, event, venue.name);
    const text = `${venue.name} is unavailable (Maintenance: Floor repairs) from ${dateLabel(date)}, 08:00 to ${dateLabel(date)}, 20:00.`;
    await expect(card.getByText("Can't be approved while this stands.")).toBeVisible();
    await expect(card.getByText(text)).toBeVisible();
    await approveInCard(card);
    await expect(toast(page)).toContainText(`Can't approve: ${text}`);

    // Ended at 09:00, before the booking's setup begins at 09:30, the period is no longer in the way.
    await updateVenue(staff, venue.id, { unavailability: [{ start: `${date}T08:00`, end: `${date}T09:00`, reason: "maintenance", note: "Floor repairs" }] });
    await page.reload();
    await expect(card).toBeVisible();
    await expect(card.getByText("Can't be approved while this stands.")).toHaveCount(0);
    await approveInCard(card);
    await expect(toast(page)).toContainText(`${venue.name} confirmed for ${event}.`);
    observed(info, `A maintenance period ${date} 08:00-20:00 added over the pending request gave "${venue.name} updated. 1 booking flagged to coordinators." The request then showed "Can't be approved while this stands." with "${text}", and Approve booking showed "Can't approve: ${text}". With the period ended at 09:00 the warning was gone and the request was confirmed ("${venue.name} confirmed for ${event}.").`);
  });

  test("[TC-US48-02] [US48-AC1] a period next to the booking only clashes once the booking's setup reaches it", async ({ page, baseURL }, info) => {
    const date = futureDate(81);
    const touching = await pendingRequest(baseURL!, date, "Touching Fair"); // held from 09:30
    const reaching = await pendingRequest(baseURL!, date, "Reaching Fair");
    await updateVenue(touching.staff, touching.venue.id, { unavailability: [{ start: `${date}T06:00`, end: `${date}T09:30`, reason: "maintenance" }] });
    await updateVenue(reaching.staff, reaching.venue.id, { unavailability: [{ start: `${date}T06:00`, end: `${date}T09:31`, reason: "maintenance" }] });
    await openBookings(page);

    await approveInCard(requestCard(page, touching.event, touching.venue.name));
    await expect(toast(page)).toContainText(`${touching.venue.name} confirmed for ${touching.event}.`);
    await approveInCard(requestCard(page, reaching.event, reaching.venue.name));
    await expect(toast(page)).toContainText(`Can't approve: ${reaching.venue.name} is unavailable (Maintenance)`);
    observed(info, `A period ending 09:30, exactly when the request's setup starts, did not stop it being confirmed. A period ending 09:31 did: "Can't approve: ${reaching.venue.name} is unavailable (Maintenance) ...".`);
  });
});
