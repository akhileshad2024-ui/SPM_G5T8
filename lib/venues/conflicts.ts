/**
 * What Venue Staff are shown about the bookings they decide on (US38, US46, US47, US48) — pure helpers, no
 * React. The server works out every conflict (backend/venue_conflicts.py) and every "Requires Reassessment"
 * flag (backend/venue_reassessment.py); these only pick them apart for display.
 */
import type { BookingConflict, EventRecord, VenueBookingRecord } from "../types";

/** The conflicts that stop a booking being confirmed: a confirmed booking or an unavailable period (US46, US48). */
export function blockingConflicts(booking: Pick<VenueBookingRecord, "conflicts">): BookingConflict[] {
  return booking.conflicts.filter((c) => c.blocks_approval);
}

/** The other pending requests that overlap this booking (US47). */
export function pendingConflicts(booking: Pick<VenueBookingRecord, "conflicts">): BookingConflict[] {
  return booking.conflicts.filter((c) => c.kind === "pending_request");
}

/** Whether Venue Staff have to choose between this pending request and another one (US47). */
export function needsManualResolution(booking: Pick<VenueBookingRecord, "status" | "conflicts">): boolean {
  return booking.status === "pending" && pendingConflicts(booking).length > 0;
}

/** US38: every booking that holds a venue and is marked "Requires Reassessment", with its event, soonest first. */
export function reassessmentList(events: EventRecord[]): Array<{ event: EventRecord; booking: VenueBookingRecord }> {
  return events
    .flatMap((event) =>
      (event.bookings ?? [])
        .filter((b) => b.reassessment !== null && (b.status === "pending" || b.status === "approved"))
        .map((booking) => ({ event, booking })),
    )
    .sort((a, b) => a.booking.hold_start.localeCompare(b.booking.hold_start));
}
