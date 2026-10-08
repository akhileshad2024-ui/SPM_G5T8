/**
 * Venue catalogue form (US17): field state, client-side checks and conversion to
 * the API body. Pure functions so they can be unit tested; the backend applies
 * the same rules again (backend/schemas.py).
 */
import type { UnavailabilityPeriod, Venue, VenueInput } from "./types";
import { WEEKDAYS, parseDateTime, parseOperatingHours } from "./venue-rules";

export const MAX_BUFFER_MINUTES = 24 * 60;

export interface VenueFormState {
  name: string;
  location: string;
  cap: string;
  layouts: string[];
  facilities: string[];
  accessibility: string[];
  openTime: string;
  closeTime: string;
  operatingDays: string[];
  setupMinutes: string;
  turnaroundMinutes: string;
  unavailability: UnavailabilityPeriod[];
}

export function venueFormFrom(v?: Venue | null): VenueFormState {
  const [open, close] = (v?.operatingHours ?? "08:00 - 22:00").split(" - ");
  return {
    name: v?.name ?? "",
    location: v?.location ?? "",
    cap: v ? String(v.cap) : "",
    layouts: v?.layouts ?? [],
    facilities: v?.facilities ?? [],
    accessibility: v?.accessibility ?? [],
    openTime: open ?? "08:00",
    closeTime: close ?? "22:00",
    operatingDays: v?.operatingDays ?? WEEKDAYS.slice(0, 5),
    setupMinutes: String(v?.setupMinutes ?? 0),
    turnaroundMinutes: String(v?.turnaroundMinutes ?? 0),
    // <input type="datetime-local"> wants "YYYY-MM-DDTHH:MM"
    unavailability: (v?.unavailability ?? []).map((p) => ({ ...p, start: p.start.slice(0, 16), end: p.end.slice(0, 16) })),
  };
}

function isWholeNumber(text: string): boolean {
  return /^\d+$/.test(text.trim());
}

/** Field name -> message; keys match the backend's field names so its errors show in the same places. */
export function validateVenueForm(f: VenueFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.name.trim()) errors.name = "Enter the venue name.";
  if (!f.location.trim()) errors.location = "Enter where the venue is.";
  if (!isWholeNumber(f.cap) || parseInt(f.cap, 10) <= 0) errors.cap = "Capacity must be a whole number greater than 0.";
  if (!parseOperatingHours(`${f.openTime} - ${f.closeTime}`)) errors.operatingHours = "Closing time must be after opening time.";
  if (f.operatingDays.length === 0) errors.operatingDays = "Pick at least one operating day.";
  for (const field of ["setupMinutes", "turnaroundMinutes"] as const) {
    if (!isWholeNumber(f[field]) || parseInt(f[field], 10) > MAX_BUFFER_MINUTES) {
      errors[field] = `Enter whole minutes from 0 to ${MAX_BUFFER_MINUTES}.`;
    }
  }
  f.unavailability.forEach((p, i) => {
    const start = parseDateTime(p.start);
    const end = parseDateTime(p.end);
    if (start == null || end == null) errors[`unavailability.${i}`] = "Enter a start and an end.";
    else if (end <= start) errors[`unavailability.${i}`] = "The end must be after the start.";
    else if (p.reason === "other" && !p.note?.trim()) errors[`unavailability.${i}`] = 'Add a note when the reason is "Other".';
  });
  return errors;
}

export function venueInputFrom(f: VenueFormState): VenueInput {
  return {
    name: f.name.trim(),
    location: f.location.trim(),
    cap: parseInt(f.cap, 10),
    layouts: f.layouts,
    facilities: f.facilities,
    accessibility: f.accessibility,
    operatingHours: `${f.openTime} - ${f.closeTime}`,
    operatingDays: WEEKDAYS.filter((d) => f.operatingDays.includes(d)),
    setupMinutes: parseInt(f.setupMinutes, 10),
    turnaroundMinutes: parseInt(f.turnaroundMinutes, 10),
    unavailability: f.unavailability.map((p) => ({ ...p, note: p.note?.trim() || null })),
  };
}
