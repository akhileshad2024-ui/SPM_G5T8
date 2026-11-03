import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { PRIYA, apiAs, unique } from "./app";
import { confirmVia } from "./bookings";
import { DANIEL, createVenue, eventFor, futureDate, updateVenue, type Venue } from "./venues";

/**
 * Helpers for the replacement venue functional tests (US40).
 *
 * "Given" steps (an event whose booking Venue Staff made unavailable, Venue Staff deciding) go through the API;
 * "When" and "Then" steps go through the browser, on the coordinator's Review queue and Venue tab.
 */

export interface FlaggedEvent {
  eventId: number;
  name: string;
  date: string;
  original: Venue;
  spare: Venue;
  bookingId: number;
  priya: APIRequestContext;
  staff: APIRequestContext;
}

/**
 * Given: an approved event of Priya's with an approved booking for 40 people (classroom layout, "Breakout session") at
 * a venue that Venue Staff then make unavailable that day, so the booking is flagged as needing alternative
 * arrangements; and a second venue that is free.
 */
export async function flaggedEvent(baseURL: string, label: string, daysAhead = 45): Promise<FlaggedEvent> {
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const date = futureDate(daysAhead);
  const hall = { cap: 300, layouts: ["theatre", "classroom"], setupMinutes: 0, turnaroundMinutes: 0 };
  const original = await createVenue(staff, { ...hall, name: unique("Original Hall") });
  const spare = await createVenue(staff, { ...hall, name: unique("Spare Hall") });
  const name = unique(label);
  const eventId = await eventFor(baseURL, name, { date, attendance: 120 });
  const res = await priya.post(`/api/venues/${original.id}/booking-requests`, {
    data: { event_id: eventId, acknowledged: false, attendance: 40, layout: "classroom", purpose: "Breakout session" },
  });
  expect(res.status(), await res.text()).toBe(200);
  const bookingId: number = (await res.json()).booking.id;
  await confirmVia(staff, bookingId);
  await updateVenue(staff, original.id, { unavailability: [{ start: `${date}T08:00`, end: `${date}T20:00`, reason: "maintenance", note: "Floor repairs" }] });
  return { eventId, name, date, original, spare, bookingId, priya, staff };
}

/** Given: the coordinator has asked for `venue` as the replacement, through the API. Returns the new booking's id. */
export async function replaceVia(priya: APIRequestContext, flagged: FlaggedEvent, venue: Venue): Promise<number> {
  const res = await priya.post(`/api/venues/${venue.id}/booking-requests`, { data: { event_id: flagged.eventId, replaces_booking_id: flagged.bookingId } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).booking.id;
}

/** On the Venue tab: the section listing the bookings that need a replacement. */
export function needsReplacement(page: Page) {
  return page.locator('[aria-label="Bookings needing a replacement venue"]');
}

/** On the Venue tab: the row of the event's booking at `venue`. */
export function bookingRow(page: Page, venue: string) {
  return page.locator(`[aria-label="Booking at ${venue}"]`);
}
