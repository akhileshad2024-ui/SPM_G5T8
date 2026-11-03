/**
 * Replacing a booking whose venue became unavailable (US40) — pure helpers, no React. The server flags the
 * booking (US39), links a replacement request to it, and releases the original and clears its flag once the
 * replacement is approved (backend/venue_bookings.py); these only pick the bookings apart for display.
 */
import type { EventRecord, VenueBookingRecord } from "../types";

export interface FlaggedBooking {
  event: EventRecord;
  booking: VenueBookingRecord;
}

const HOLDING = ["pending", "approved"];

/** Whether the booking still holds its venue (pending or approved). */
function holds(booking: Pick<VenueBookingRecord, "status">): boolean {
  return HOLDING.includes(booking.status);
}

/** US40 AC1: every booking that still holds a venue and is flagged as needing alternative arrangements. */
export function flaggedBookings(events: EventRecord[]): FlaggedBooking[] {
  return events.flatMap((event) =>
    (event.bookings ?? []).filter((b) => holds(b) && b.flag !== null && b.flag !== undefined).map((booking) => ({ event, booking })),
  );
}

/** Whether any of the event's bookings needs alternative arrangements. */
export function hasFlaggedBooking(event: Pick<EventRecord, "bookings">): boolean {
  return flaggedBookings([event as EventRecord]).length > 0;
}

/** The pending or approved booking that already replaces `booking`, if there is one (only one may be open at a time). */
export function openReplacement(event: Pick<EventRecord, "bookings">, booking: Pick<VenueBookingRecord, "id">): VenueBookingRecord | undefined {
  return (event.bookings ?? []).find((b) => b.replaces_booking_id === booking.id && holds(b));
}

/** The booking `booking` replaces, kept for reference (null when it is an ordinary request). */
export function originalOf(event: Pick<EventRecord, "bookings">, booking: Pick<VenueBookingRecord, "replaces_booking_id">): VenueBookingRecord | undefined {
  return booking.replaces_booking_id == null ? undefined : (event.bookings ?? []).find((b) => b.id === booking.replaces_booking_id);
}

/** The approved booking that replaced `booking` (so the released original can say what took its place). */
export function replacedBy(event: Pick<EventRecord, "bookings">, booking: Pick<VenueBookingRecord, "id">): VenueBookingRecord | undefined {
  return (event.bookings ?? []).find((b) => b.replaces_booking_id === booking.id && b.status === "approved");
}
