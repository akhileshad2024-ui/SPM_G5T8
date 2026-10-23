/**
 * Venue search (US20) — pure helpers, no React: the search form's state, the request the backend
 * expects (`VenueSearchRequest` in backend/schemas.py), and clearing one filter at a time.
 * The searching itself happens in the backend (backend/venue_search.py).
 */
import type { VenueFilterKey, VenueSearchFilters } from "../types";

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

export function buildSearchRequest(filters: VenueSearchFilters): VenueSearchRequest {
  const request: VenueSearchRequest = { accessibility: filters.accessibility, facilities: filters.facilities };
  if (filters.date) {
    request.date = filters.date;
    request.start = filters.start;
    request.end = filters.end;
  }
  if (filters.attendance) request.attendance = Number(filters.attendance);
  if (filters.location.trim()) request.location = filters.location.trim();
  if (filters.layout) request.layout = filters.layout;
  return request;
}
