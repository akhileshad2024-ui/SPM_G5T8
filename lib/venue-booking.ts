/**
 * Venue booking requests (US22) — pure helpers, no React: the request the backend expects
 * (`BookingRequestCreate` in backend/schemas.py) and what must be true before one can be sent.
 * The rules themselves are enforced by the backend (backend/booking_request.py).
 */
import type { EventRecord } from "./types";
import { eventTiming } from "./venue-suitability";
import { heldBookings, type VenueSearchRequest } from "./venue-search";

/** Body for POST /venues/{id}/booking-requests. */
export interface BookingRequestBody {
  event_id: string;
  event_name: string;
  event_status: string;
  rebooking: boolean;
  date: string;
  start: string;
  end: string;
  attendance: number;
  layout: string;
  facilities: string[];
  accessibility: string[];
  acknowledged: boolean;
  bookings: VenueSearchRequest["bookings"];
}

/** An event that already went through a booking (a replacement venue, or a new request after a rejection). */
export function isRebooking(event: Pick<EventRecord, "bookingState">): boolean {
  return event.bookingState !== null;
}

/** Why this event can't ask for a venue yet, or null when it can. The backend checks the same things. */
export function bookingProblem(event: EventRecord): string | null {
  const allowed = isRebooking(event) ? ["approved", "planning", "confirmed"] : ["approved"];
  if (!allowed.includes(event.status)) return "A venue can only be requested for an approved event.";
  if (!eventTiming(event)) return "Set the event's date, start time and end time first.";
  return null;
}

/** The request for `event`. Only call this when `bookingProblem(event)` is null. */
export function buildBookingRequest(event: EventRecord, events: EventRecord[], warningAcknowledged: boolean): BookingRequestBody {
  const timing = eventTiming(event)!;
  return {
    event_id: event.id,
    event_name: event.name,
    event_status: event.status,
    rebooking: isRebooking(event),
    date: timing.date,
    start: timing.start,
    end: timing.end,
    attendance: event.pax,
    layout: event.layout,
    facilities: event.facilities,
    accessibility: event.access,
    acknowledged: warningAcknowledged,
    bookings: heldBookings(events), // every booking that holds a venue, so a second pending request for the same slot is caught
  };
}
