/**
 * Venue search (US20) — pure helpers, no React: the search form's state, the request the backend
 * expects (`VenueSearchRequest` in backend/schemas.py), and clearing one filter at a time.
 * The searching itself happens in the backend (backend/venue_search.py).
 */
import type { EventRecord, VenueFilterKey, VenueSearchFilters } from "../types";
import { holdsBooking, toIsoDate } from "./rules";

export const EMPTY_FILTERS: VenueSearchFilters = {
  date: "",
  start: "",
  end: "",
  attendance: "",
  location: "",
  accessibility: [],
  layout: "",
  facilities: [],
};

/** Body for POST /venues/search. */
export interface VenueSearchRequest {
  date?: string;
  start?: string;
  end?: string;
  attendance?: number;
  location?: string;
  accessibility: string[];
  layout?: string;
  facilities: string[];
  bookings: Array<{
    venue_id: number;
    date: string;
    start: string;
    end: string;
    status: "pending" | "approved";
    event_id: string;
    event_name: string;
  }>;
}

/** Clears one filter, leaving the others as they were. "timing" is the date and both times together. */
export function clearFilter(filters: VenueSearchFilters, key: VenueFilterKey): VenueSearchFilters {
  switch (key) {
    case "timing":
      return { ...filters, date: "", start: "", end: "" };
    case "attendance":
      return { ...filters, attendance: "" };
    case "location":
      return { ...filters, location: "" };
    case "accessibility":
      return { ...filters, accessibility: [] };
    case "layout":
      return { ...filters, layout: "" };
    case "facilities":
      return { ...filters, facilities: [] };
  }
}

/** Why the form can't be searched yet, or null when it can. The backend checks the same things. */
export function filterProblem(filters: VenueSearchFilters): string | null {
  const timing = [filters.date, filters.start, filters.end];
  if (timing.some(Boolean) && !timing.every(Boolean)) return "Give the date, start time and end time together.";
  if (filters.start && filters.end <= filters.start) return "The end time must be after the start time.";
  if (filters.attendance && !(Number.isInteger(+filters.attendance) && +filters.attendance > 0)) {
    return "Expected attendance must be a whole number above 0.";
  }
  return null;
}

/** The bookings that currently hold a venue, which a search or request must keep clear of. `exceptEventId` leaves one event's own out. */
export function heldBookings(events: EventRecord[], exceptEventId?: string): VenueSearchRequest["bookings"] {
  const clock = /^\d{2}:\d{2}$/;
  const held: VenueSearchRequest["bookings"] = [];
  for (const e of events) {
    const venueId = Number(e.venue);
    const date = toIsoDate(e.date);
    if (e.id === exceptEventId || !holdsBooking(e) || !Number.isInteger(venueId) || !date || !clock.test(e.start) || !clock.test(e.end)) continue;
    held.push({
      venue_id: venueId,
      date,
      start: e.start,
      end: e.end,
      status: e.bookingState === "approved" ? "approved" : "pending",
      event_id: e.id,
      event_name: e.name,
    });
  }
  return held;
}

export function buildSearchRequest(filters: VenueSearchFilters, events: EventRecord[]): VenueSearchRequest {
  const request: VenueSearchRequest = { accessibility: filters.accessibility, facilities: filters.facilities, bookings: [] };
  if (filters.date) {
    request.date = filters.date;
    request.start = filters.start;
    request.end = filters.end;
    request.bookings = heldBookings(events); // only matters when searching a period
  }
  if (filters.attendance) request.attendance = Number(filters.attendance);
  if (filters.location.trim()) request.location = filters.location.trim();
  if (filters.layout) request.layout = filters.layout;
  return request;
}
