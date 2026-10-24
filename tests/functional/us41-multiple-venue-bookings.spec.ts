import { expect, test, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, toast, unique } from "./support/app";
import { DANIEL, createVenue, eventFor, futureDate, observed, openVenueTab, resultCard, type Venue } from "./support/venues";

/**
 * US41 — Manage Multiple Venue Bookings for an Event (functional).
 * "As an Event Coordinator, I want one event to have bookings at several venues so that larger events
 * can use several spaces at the same time."
 *
 * Each test makes a hall (theatre, 200) and a seminar room (classroom, 40) and an approved event
 * (120 people, theatre) on a future date. Test cases: tests/functional/report/test_cases.py.
 */
const NEEDS = { facilities: ["Projector"], accessibility: ["Wheelchair Access"] };

async function setUp(baseURL: string, daysAhead: number) {
  const staff = await apiAs(baseURL, DANIEL);
  const hall = await createVenue(staff, { name: unique("Main Hall"), cap: 200, layouts: ["theatre"], ...NEEDS });
  const room = await createVenue(staff, { name: unique("Seminar Room"), cap: 40, layouts: ["classroom"], ...NEEDS });
  const event = unique("Research Festival");
  const eventId = await eventFor(baseURL, event, { attendance: 120, layout: "theatre", date: futureDate(daysAhead), ...NEEDS });
  return { staff, hall, room, event, eventId };
}

const newBooking = (page: Page) => page.locator('[aria-label="New booking"]');
const bookingsList = (page: Page) => page.locator('[aria-label="Venue bookings for this event"]');
/** The event's latest booking at `venue` (the list is oldest first, and keeps cancelled bookings). */
const bookingRow = (page: Page, venue: Venue) => page.locator(`li[aria-label="Booking at ${venue.name}"]`).last();

async function openEvent(page: Page, event: string) {
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, event);
  await openVenueTab(page);
}

/** Fills the New booking needs, waits for the venues to be checked against them, and requests `venue`. */
async function book(page: Page, venue: Venue, needs: { purpose?: string; attendance?: string; layout?: string } = {}) {
  if (needs.purpose !== undefined) await newBooking(page).getByLabel("Purpose").fill(needs.purpose);
  if (needs.attendance !== undefined) await newBooking(page).getByLabel("Attendance").fill(needs.attendance);
  if (needs.layout !== undefined) await newBooking(page).getByLabel("Layout").selectOption(needs.layout);
  await expect(resultCard(page, venue.name).getByText("Suitable", { exact: true })).toBeVisible();
  await Promise.all([
    page.waitForResponse((r) => /\/api\/venues\/\d+\/booking-requests/.test(r.url())),
    resultCard(page, venue.name).getByRole("button", { name: "Request booking", exact: true }).click(),
  ]);
  await expect(bookingRow(page, venue)).toBeVisible();
}

const BREAKOUT = { purpose: "Breakout session", attendance: "30", layout: "classroom" };

test.describe("US41 - Manage Multiple Venue Bookings for an Event", () => {
  test("[TC-US41-01] [US41-AC1] one event can request several venues, each once", async ({ page, baseURL }, info) => {
    const { hall, room, event, eventId } = await setUp(baseURL!, 60);
    await openEvent(page, event);

    await book(page, hall, { purpose: "Main programme" });
    await book(page, room, BREAKOUT);

    await expect(bookingRow(page, hall).locator(".pill")).toHaveText("Pending");
    await expect(bookingRow(page, room).locator(".pill")).toHaveText("Pending");
    await expect(resultCard(page, room.name).getByRole("button", { name: "Requested" })).toBeVisible();
    const again = await (await apiAs(baseURL!, PRIYA)).post(`/api/venues/${room.id}/booking-requests`, {
      data: { event_id: eventId, attendance: 30, layout: "classroom" },
    });
    expect(again.status()).toBe(409);
    observed(info, `${event} has pending bookings at ${hall.name} and ${room.name}; the room's card shows "Requested", and asking for the room again was refused (409).`);
  });

  test("[TC-US41-02] [US41-AC2] attendance, layout and purpose are set for each booking", async ({ page, baseURL }, info) => {
    const { hall, room, event } = await setUp(baseURL!, 62);
    await openEvent(page, event);

    await book(page, hall, { purpose: "Main programme" });
    await book(page, room, BREAKOUT);

    await expect(bookingRow(page, hall)).toContainText("Main programme");
    await expect(bookingRow(page, hall)).toContainText("120 people · Theatre layout");
    await expect(bookingRow(page, room)).toContainText("Breakout session");
    await expect(bookingRow(page, room)).toContainText("30 people · Classroom layout");
    observed(info, `The hall booking shows "Main programme, 120 people · Theatre layout"; the room booking shows "Breakout session, 30 people · Classroom layout".`);
  });

  test("[TC-US41-03] [US41-AC3] each booking is checked on its own for suitability", async ({ page, baseURL }, info) => {
    const { room, event } = await setUp(baseURL!, 64);
    await openEvent(page, event);

    // With the event's own needs (120 people, theatre) the 40-seat classroom is unsuitable...
    await expect(resultCard(page, room.name).getByText("Unsuitable", { exact: true })).toBeVisible();
    // ...but it suits a 30-person classroom breakout.
    await newBooking(page).getByLabel("Attendance").fill("30");
    await newBooking(page).getByLabel("Layout").selectOption("classroom");
    await expect(resultCard(page, room.name).getByText("Suitable", { exact: true })).toBeVisible();
    observed(info, `${room.name} was Unsuitable for the whole event (120, theatre) and Suitable once the booking was set to 30 people, classroom.`);
  });

  test("[TC-US41-04] [US41-AC4] all of the event's bookings are seen together with their statuses", async ({ page, browser, baseURL }, info) => {
    const { hall, room, event } = await setUp(baseURL!, 66);
    await openEvent(page, event);
    await book(page, hall);
    await book(page, room, BREAKOUT);

    // Venue Staff see one request per booking and approve the hall only.
    const staffPage = await (await browser.newContext({ baseURL })).newPage();
    await signIn(staffPage, DANIEL, /\/bookings/);
    const card = (venue: Venue) => staffPage.locator(`[aria-label="Booking request: ${event} at ${venue.name}"]`);
    await expect(card(hall)).toBeVisible();
    await expect(card(room)).toContainText("Breakout session");
    await card(hall).getByRole("button", { name: "Approve booking" }).click();
    await expect(toast(staffPage)).toContainText(`${hall.name} confirmed`);

    await page.reload();
    await openInQueue(page, event);
    await openVenueTab(page);
    await expect(bookingsList(page)).toContainText("2 active");
    await expect(bookingRow(page, hall).locator(".pill")).toHaveText("Approved");
    await expect(bookingRow(page, room).locator(".pill")).toHaveText("Pending");
    observed(info, `Venue Staff saw separate requests for ${hall.name} and ${room.name} (Breakout session) and approved the hall. The coordinator's list showed the hall Approved and the room Pending together.`);
  });

  test("[TC-US41-05] [US41-AC5] one booking can be changed or cancelled without affecting the others, or all cancelled", async ({ page, baseURL }, info) => {
    const { hall, room, event } = await setUp(baseURL!, 68);
    await openEvent(page, event);
    await book(page, hall, { purpose: "Main programme" });
    await book(page, room, BREAKOUT);

    // Change the breakout's attendance.
    await bookingRow(page, room).getByRole("button", { name: "Change" }).click();
    await bookingRow(page, room).getByLabel("Attendance").fill("35");
    await bookingRow(page, room).getByRole("button", { name: "Save change" }).click();
    await expect(toast(page)).toContainText(`${room.name} booking changed.`);
    await expect(bookingRow(page, room)).toContainText("35 people");
    await expect(bookingRow(page, hall)).toContainText("120 people · Theatre layout");

    // Cancel the hall only.
    await bookingRow(page, hall).getByRole("button", { name: "Cancel booking" }).click();
    await bookingRow(page, hall).getByRole("button", { name: "Confirm cancel" }).click();
    await expect(bookingRow(page, hall).locator(".pill")).toHaveText("Cancelled");
    await expect(bookingRow(page, room).locator(".pill")).toHaveText("Pending");

    // Book the hall again, then cancel everything.
    await book(page, hall);
    await bookingsList(page).getByRole("button", { name: "Cancel all bookings" }).click();
    await bookingsList(page).getByRole("button", { name: "Yes, cancel all" }).click();
    await expect(toast(page)).toContainText("2 bookings cancelled.");
    await expect(bookingsList(page)).toContainText("0 active");
    observed(info, `Changing the breakout to 35 people left the hall at 120; cancelling the hall left the breakout pending; "Cancel all bookings" then cancelled the remaining two.`);
  });
});
