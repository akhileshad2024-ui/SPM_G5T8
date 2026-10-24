import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, toast, unique } from "./support/app";
import { DANIEL, catalogueCard, createVenue, eventFor, futureDate, observed, openVenueTab, updateVenue, type Venue } from "./support/venues";

/**
 * US39 — Mark Venue Temporarily Unavailable (functional).
 * "As a Venue Staff member, I want to mark a venue temporarily unavailable for a period so that it
 * is not used or booked while it cannot operate."
 *
 * AC2's calendar half depends on US19 (the Bookings calendar is still fixed to one week), so only
 * the search half is tested here.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */

interface Booking {
  id: number;
  event_id: number;
  status: string;
  flag: { kind: string; reason: string; message: string } | null;
}

/** Given: a venue, and an approved event on `date` 10:00-12:00 whose booking of it Venue Staff approved. */
async function bookedVenue(baseURL: string, date: string) {
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const venue = await createVenue(staff, {
    name: unique("Closing Hall"), cap: 200, layouts: ["theatre"], facilities: ["Projector"], accessibility: ["Wheelchair Access"],
    setupMinutes: 30, turnaroundMinutes: 45,
  });
  const event = unique("Unavailable Keynote");
  const eventId = await eventFor(baseURL, event, { attendance: 120, layout: "theatre", facilities: ["Projector"], accessibility: ["Wheelchair Access"], date });
  const requested = await priya.post(`/api/venues/${venue.id}/booking-requests`, { data: { event_id: eventId, acknowledged: false } });
  expect(requested.ok(), await requested.text()).toBeTruthy();
  const bookingId: number = (await requested.json()).booking.id;
  const decided = await staff.post(`/api/bookings/${bookingId}/decision`, { data: { outcome: "approved", reason: "" } });
  expect(decided.ok(), await decided.text()).toBeTruthy();
  return { staff, priya, venue, event, eventId, bookingId };
}

/** The coordinator's view of one saved booking (GET /bookings). */
async function bookingOf(priya: APIRequestContext, id: number): Promise<Booking> {
  const rows: Booking[] = await (await priya.get("/api/bookings")).json();
  return rows.find((b) => b.id === id)!;
}

async function editVenue(page: Page, venue: Venue) {
  await signIn(page, DANIEL, /\/bookings/);
  await page.goto("/catalogue");
  await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
}

/** In the open venue form: add an unavailable period. */
async function addPeriod(page: Page, start: string, end: string, reason: string, note = "") {
  await page.getByRole("button", { name: "+ Add unavailable period" }).click();
  await page.getByLabel("Unavailable from").last().fill(start);
  await page.getByLabel("Unavailable until").last().fill(end);
  await page.getByLabel("Reason").last().selectOption({ label: reason });
  if (note) await page.getByLabel("Note").last().fill(note);
}

test.describe("US39 - Mark Venue Temporarily Unavailable", () => {
  test("[TC-US39-01] [US39-AC1] Venue Staff can record an unavailable period with a start, an end and a reason", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff, { name: unique("Period Hall") });
    const date = futureDate(50);
    await editVenue(page, venue);
    const save = page.getByRole("button", { name: "Save Venue" });

    await page.getByRole("button", { name: "+ Add unavailable period" }).click();
    const reasons = await page.getByLabel("Reason").locator("option").allTextContents();
    expect(reasons).toEqual(["Maintenance", "Equipment failure", "Renovation", "Safety concern", "Internal activity", "Other"]);

    await page.getByLabel("Unavailable from").fill(`${date}T12:00`);
    await page.getByLabel("Unavailable until").fill(`${date}T08:00`);
    await save.click();
    await expect(page.getByText("The end must be after the start.")).toBeVisible();

    await page.getByLabel("Unavailable until").fill(`${date}T18:00`);
    await page.getByLabel("Reason").selectOption({ label: "Other" });
    await save.click();
    await expect(page.getByText('Add a note when the reason is "Other".')).toBeVisible();

    await page.getByLabel("Note").fill("Flooded after the storm");
    await save.click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);

    const saved: Venue = await (await staff.get(`/api/venues/${venue.id}`)).json();
    expect(saved.unavailability).toEqual([{ start: `${date}T12:00:00`, end: `${date}T18:00:00`, reason: "other", note: "Flooded after the storm" }]);
    observed(info, `The Reason list offered ${reasons.join(", ")}. An end before the start showed "The end must be after the start."; "Other" with no note showed 'Add a note when the reason is "Other".'. With a note the venue was updated and saved the period ${date} 12:00-18:00, reason other, note "Flooded after the storm".`);
  });

  test("[TC-US39-02] [US39-AC2] the venue is left out of venue search for the period", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Closed Plaza");
    const date = futureDate(52);
    const venue = await createVenue(staff, { name: unique("Searchable Hall"), location, setupMinutes: 0, turnaroundMinutes: 0 });

    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/venues");
    await page.locator("label.field").filter({ has: page.getByText("Location", { exact: true }) }).locator("select").selectOption({ label: location });
    const searchOn = async (day: string) => {
      await page.getByLabel("Date", { exact: true }).fill(day);
      await page.getByLabel("Start time").fill("10:00");
      await page.getByLabel("End time").fill("12:00");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/venues/search") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Search", exact: true }).click(),
      ]);
      await expect(page.getByText(/venues? found|No venues match/)).toBeVisible();
      return (await page.getByText(venue.name, { exact: true }).count()) > 0;
    };

    expect(await searchOn(date), "before the period is recorded").toBe(true);
    await updateVenue(staff, venue.id, { unavailability: [{ start: `${date}T08:00`, end: `${date}T20:00`, reason: "renovation" }] });
    expect(await searchOn(date), "during the period").toBe(false);
    const nextDay = futureDate(53);
    expect(await searchOn(nextDay), "the day after the period").toBe(true);
    observed(info, `Searching ${date} 10:00-12:00 listed ${venue.name} before the period was recorded and not after (renovation ${date} 08:00-20:00). On ${nextDay} it was listed again.`);
  });

  test("[TC-US39-03] [US39-AC3] [US39-AC4] an overlapping booking is flagged, kept and the event left unchanged", async ({ page, baseURL }, info) => {
    const date = futureDate(54);
    const { priya, venue, event, eventId, bookingId } = await bookedVenue(baseURL!, date);
    const before = await (await priya.get(`/api/events/${eventId}`)).json();

    await editVenue(page, venue);
    await addPeriod(page, `${date}T08:00`, `${date}T20:00`, "Maintenance");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated. 1 booking flagged to coordinators.`);

    await page.goto("/bookings");
    const attention = page.locator(".card", { hasText: event }).filter({ hasText: /is unavailable \(Maintenance\)/ });
    await expect(page.getByText("Confirmed bookings needing attention")).toBeVisible();
    await expect(attention).toBeVisible();

    const booking = await bookingOf(priya, bookingId);
    expect(booking.status).toBe("approved");
    expect(booking.flag?.kind).toBe("venue_unavailable");
    expect(booking.flag?.message).toContain("A replacement venue is required.");
    const after = await (await priya.get(`/api/events/${eventId}`)).json();
    for (const field of ["status", "name", "date", "start", "end", "venue", "bookingState", "pax", "layout"]) {
      expect(after[field], field).toEqual(before[field]);
    }
    observed(info, `Saving a maintenance period over the booking showed "${venue.name} updated. 1 booking flagged to coordinators." and Bookings listed ${event} under "Confirmed bookings needing attention". The saved booking stayed "approved" with flag "venue_unavailable"; the event's status, name, date, times, venue and booking state were unchanged.`);
  });

  test("[TC-US39-04] [US39-AC5] the event's coordinator is notified that a replacement venue is required", async ({ page, baseURL }, info) => {
    const date = futureDate(56);
    const { staff, venue, event } = await bookedVenue(baseURL!, date);
    await updateVenue(staff, venue.id, { unavailability: [{ start: `${date}T08:00`, end: `${date}T20:00`, reason: "safety", note: "Ceiling repair" }] });

    await signIn(page, PRIYA, /\/queue/);
    const bell = page.getByRole("button", { name: /Notifications/ });
    await bell.click();
    // One notification (its CSS-module class is NotificationsPanel_item__<hash>; itemTitle/itemBody are inside it).
    // Narrowed to this notification: the coordinator also has others about the event (e.g. US23's "Venue booking approved").
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: event }).filter({ hasText: "Replacement venue required" });
    await expect(notice).toContainText("Replacement venue required");
    await expect(notice).toContainText("Safety concern: Ceiling repair");
    await bell.click();

    await openInQueue(page, event);
    await openVenueTab(page);
    await expect(page.getByText(`Alternative arrangements needed for ${venue.name}.`)).toBeVisible();
    observed(info, `Signed in as Priya, Notifications held "Replacement venue required" for ${event}, naming "Safety concern: Ceiling repair". The event's Venue tab showed "Alternative arrangements needed for ${venue.name}."`);
  });

  test("[TC-US39-05] [US39-AC6] Venue Staff can edit a period or end it early, and the flag follows", async ({ page, baseURL }, info) => {
    const date = futureDate(58);
    const { staff, priya, venue, bookingId } = await bookedVenue(baseURL!, date);
    await updateVenue(staff, venue.id, { unavailability: [{ start: `${date}T08:00`, end: `${date}T20:00`, reason: "maintenance" }] });
    expect((await bookingOf(priya, bookingId)).flag).not.toBeNull();

    // End it early: the booking holds the venue from 09:30 (30 min setup), so ending at 09:00 frees it.
    await editVenue(page, venue);
    await page.getByLabel("Unavailable until").fill(`${date}T09:00`);
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);
    expect((await bookingOf(priya, bookingId)).flag).toBeNull();

    // Edit it back over the booking, then remove it.
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Unavailable until").fill(`${date}T20:00`);
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText("1 booking flagged to coordinators.");
    expect((await bookingOf(priya, bookingId)).flag).not.toBeNull();

    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);
    const finalBooking = await bookingOf(priya, bookingId);
    expect(finalBooking.flag).toBeNull();
    expect(finalBooking.status).toBe("approved");
    observed(info, `Ending the period at 09:00 (before the booking's 09:30 setup) cleared the booking's flag. Extending it back to 20:00 flagged it again ("1 booking flagged to coordinators."). Removing the period cleared the flag; the booking stayed approved throughout.`);
  });
});
