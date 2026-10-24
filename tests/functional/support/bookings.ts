import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { signIn } from "./app";
import { DANIEL } from "./venues";

/**
 * Helpers for the venue booking functional tests (US38, US46, US47, US48).
 *
 * "Given" steps (requesting and deciding bookings) go through the API; "When" and "Then" steps go
 * through the browser, on Venue Staff's Booking requests page.
 */

export interface BookingConflict {
  kind: "confirmed_booking" | "pending_request" | "unavailable_period";
  message: string;
  blocks_approval: boolean;
  event_name: string | null;
}

export interface BookingRecord {
  id: number;
  event_id: number;
  event_name: string;
  venue_id: number;
  status: string;
  setup_minutes: number;
  teardown_minutes: number;
  hold_start: string;
  hold_end: string;
  conflicts: BookingConflict[];
  reassessment: { reason: string; message: string; setup_minutes: number; turnaround_minutes: number; clashes_with: BookingConflict[] } | null;
  flag: { kind: string; message: string } | null;
}

/** Given: the coordinator has asked for the venue for the event. Returns the saved booking. */
export async function requestVenue(coordinator: APIRequestContext, venueId: number, eventId: number, acknowledged = false): Promise<BookingRecord> {
  const res = await coordinator.post(`/api/venues/${venueId}/booking-requests`, { data: { event_id: eventId, acknowledged } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).booking;
}

/** Venue Staff approve or reject a booking, through the API. */
export function decideVia(staff: APIRequestContext, bookingId: number, outcome: "approved" | "rejected", reason = ""): Promise<APIResponse> {
  return staff.post(`/api/bookings/${bookingId}/decision`, { data: { outcome, reason } });
}

/** Given: Venue Staff have confirmed the booking. */
export async function confirmVia(staff: APIRequestContext, bookingId: number): Promise<void> {
  const res = await decideVia(staff, bookingId, "approved");
  expect(res.status(), await res.text()).toBe(200);
}

/** Every booking a user is sent (GET /bookings), by event name. */
export async function bookingsBy(api: APIRequestContext): Promise<Record<string, BookingRecord>> {
  const rows: BookingRecord[] = await (await api.get("/api/bookings")).json();
  return Object.fromEntries(rows.map((row) => [row.event_name, row]));
}

/** Signs in as Venue Staff, who land on the Booking requests page. */
export async function openBookings(page: Page): Promise<void> {
  await signIn(page, DANIEL, /\/bookings/);
  await expect(page.getByText("Pending booking requests")).toBeVisible(); // the page has loaded
}

/**
 * Goes to the Venue catalogue and waits until the page has loaded the bookings, so that a venue edit made next can
 * tell which bookings it flags (the message "N bookings flagged to coordinators" counts the ones the page knows).
 */
export async function openCatalogue(page: Page): Promise<void> {
  const loaded = page.waitForResponse((r) => r.url().endsWith("/api/bookings") && r.request().method() === "GET");
  await page.goto("/catalogue");
  await loaded;
  await expect(page.getByRole("heading", { name: "Venue Catalogue" })).toBeVisible();
}

/** On the Booking requests page: the card of a pending request. */
export function requestCard(page: Page, event: string, venue: string) {
  return page.locator(`[aria-label="Booking request: ${event} at ${venue}"]`);
}

/** On the Booking requests page: the entry under "Bookings requiring reassessment". */
export function reassessmentCard(page: Page, event: string, venue: string) {
  return page.locator(`[aria-label="Requires reassessment: ${event} at ${venue}"]`);
}

/** The label on a pending request: "Requires Reassessment" or "Needs manual resolution" (the callout text ends with a full stop). */
export function pill(card: ReturnType<typeof requestCard>, label: string) {
  return card.getByText(label, { exact: true });
}

/** In a pending request's card: press Approve booking. */
export async function approveInCard(card: ReturnType<typeof requestCard>): Promise<void> {
  await card.getByRole("button", { name: "Approve booking" }).click();
}

/** The text of the conflict a pending request is flagged with, e.g. "Clashes with <event>, already booked on <date> (venue occupied ...)". */
export function clashText(event: string, status: "booked" | "requested", date: string, window: string): string {
  return `Clashes with ${event}, already ${status} on ${date} (venue occupied ${window}).`;
}
