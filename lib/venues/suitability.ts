/**
 * Venue suitability (US21) — pure helpers, no React: the request the backend expects
 * (`SuitabilityRequest` in backend/schemas.py) and how its answer is worded. The checking
 * itself happens in the backend (backend/venue_suitability.py).
 */
import type { EventRecord, RequirementCheck, SuitabilityVerdict } from "../types";
import { heldBookings, type VenueSearchRequest } from "./search";
import { toIsoDate } from "./rules";

export const VERDICT_LABEL: Record<SuitabilityVerdict, string> = {
  suitable: "Suitable",
  partially_suitable: "Partially suitable",
  unsuitable: "Unsuitable",
};

/** Badge colours for each verdict. */
export const VERDICT_COLOURS: Record<SuitabilityVerdict, { bg: string; fg: string }> = {
  suitable: { bg: "var(--ok-bg)", fg: "var(--ok-fg)" },
  partially_suitable: { bg: "var(--warn-bg)", fg: "var(--warn-fg)" },
  unsuitable: { bg: "var(--bad-bg)", fg: "var(--bad-fg)" },
};

/** Body for POST /venues/suitability. */
export interface SuitabilityRequest {
  attendance: number;
  layout?: string;
  facilities: string[];
  accessibility: string[];
  date?: string;
  start?: string;
  end?: string;
  bookings: VenueSearchRequest["bookings"];
}

const CLOCK = /^\d{2}:\d{2}$/;

/** The event's date and times in the form the backend wants, or null while the event has no real date and times yet. */
export function eventTiming(event: Pick<EventRecord, "date" | "start" | "end">): { date: string; start: string; end: string } | null {
  const date = toIsoDate(event.date);
  return date && CLOCK.test(event.start) && CLOCK.test(event.end) && event.end > event.start
    ? { date, start: event.start, end: event.end }
    : null;
}

/**
 * The event's recorded venue needs. The event's own booking is left out of the bookings that could be in the way,
 * so the venue it already asked for is not reported as clashing with itself.
 */
export function buildSuitabilityRequest(event: EventRecord, events: EventRecord[]): SuitabilityRequest {
  const timing = eventTiming(event);
  const request: SuitabilityRequest = {
    attendance: event.pax,
    facilities: event.facilities,
    accessibility: event.access,
    bookings: [],
  };
  if (event.layout) request.layout = event.layout;
  if (timing) {
    request.date = timing.date;
    request.start = timing.start;
    request.end = timing.end;
    request.bookings = heldBookings(events, event.id);
  }
  return request;
}

/** The checks that were not met, most serious first. */
export function unmetChecks(checks: RequirementCheck[]): RequirementCheck[] {
  return checks.filter((c) => !c.met).sort((a, b) => Number(b.severity === "block") - Number(a.severity === "block"));
}
