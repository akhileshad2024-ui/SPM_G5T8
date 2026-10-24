/**
 * Venue booking requests (US22, US41) — pure helpers, no React: the request the backend expects
 * (`BookingRequestCreate` in backend/schemas.py), what must be true before one can be sent, and
 * putting the saved bookings onto the events. The rules themselves are enforced by the backend
 * (backend/booking_request.py), which reads the event, the venue and the saved bookings itself.
 */
import type { EventRecord, Layout, VenueBookingRecord } from "../types";
import { eventTiming } from "./suitability";

/** US41: one booking's own needs. Left out, the event's attendance and layout are used. */
export interface BookingDetails {
  attendance?: number;
  layout?: Layout;
  purpose?: string;
}

/** Body for POST /venues/{id}/booking-requests: the event, whether the warning was acknowledged, and this booking's needs. */
export interface BookingRequestBody extends BookingDetails {
  event_id: number;
  acknowledged: boolean;
}

/** An event that already went through a booking (another venue, or a new request after a rejection). */
export function isRebooking(event: Pick<EventRecord, "bookingState" | "bookings">): boolean {
  return event.bookingState !== null || (event.bookings?.length ?? 0) > 0;
}

/** Why this event can't ask for a venue yet, or null when it can. The backend checks the same things. */
export function bookingProblem(event: EventRecord): string | null {
  const allowed = isRebooking(event) ? ["approved", "planning", "confirmed"] : ["approved"];
  if (!allowed.includes(event.status)) return "A venue can only be requested for an approved event.";
  if (event.backendId == null) return "Save the event before requesting a venue.";
  if (!eventTiming(event)) return "Set the event's date, start time and end time first.";
  return null;
}

/** The request for `event`. Only call this when `bookingProblem(event)` is null. */
export function buildBookingRequest(event: EventRecord, warningAcknowledged: boolean, details: BookingDetails = {}): BookingRequestBody {
  const body: BookingRequestBody = { event_id: event.backendId!, acknowledged: warningAcknowledged };
  if (details.attendance) body.attendance = details.attendance;
  if (details.layout) body.layout = details.layout;
  if (details.purpose?.trim()) body.purpose = details.purpose.trim();
  return body;
}

/** Bookings that hold a venue (pending or approved), oldest first. */
export function holdingBookings(event: Pick<EventRecord, "bookings">): VenueBookingRecord[] {
  return (event.bookings ?? []).filter((b) => b.status === "pending" || b.status === "approved");
}

/**
 * Puts the saved booking requests (GET /bookings, oldest first) onto their events: all of them as
 * `bookings` (US41), the latest still-held one as `bookingRequest`, and every override recorded on any
 * of them as `venueOverrides`.
 */
export function attachBookings(events: EventRecord[], bookings: VenueBookingRecord[]): EventRecord[] {
  return events.map((e) => {
    const mine = bookings.filter((b) => b.event_id === e.backendId);
    if (mine.length === 0) return e;
    const current = [...mine].reverse().find((b) => b.status !== "cancelled") ?? mine[mine.length - 1];
    return { ...e, bookings: mine, bookingRequest: current, venueOverrides: mine.flatMap((b) => (b.override ? [b.override] : [])) };
  });
}
