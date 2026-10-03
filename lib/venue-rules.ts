/**
 * Venue availability rules — pure functions, no React, so they can be unit tested.
 *
 * Week 7 change #1: a booking occupies its venue from (start - setup) to
 * (end + turnaround), not just the advertised event times, and that whole
 * window is used when checking availability and detecting conflicts.
 * Week 7 change #2: a venue can be unavailable for a period with a reason;
 * bookings caught by that are flagged, never removed.
 */
import type { ApiVenue, EventRecord, UnavailabilityReason, Venue } from "./types";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const UNAVAILABILITY_REASONS: Record<UnavailabilityReason, string> = {
  maintenance: "Maintenance",
  equipment_failure: "Equipment failure",
  renovation: "Renovation",
  safety: "Safety concern",
  internal_activity: "Internal activity",
  other: "Other",
};

export interface Issue {
  level: "block" | "warn";
  text: string;
}

/** A span of time in minutes since 1970-01-01 00:00 (local wall-clock time; no time zones involved). */
export interface Window {
  start: number;
  end: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MINUTES = 24 * 60;

// ---------------------------------------------------------------- parsing & formatting

function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) / 60000 / DAY_MINUTES;
}

/** "14 Mar 2026" / "14 Sept 2026" / "2026-03-14" -> days since epoch, or null if there's no real date yet. */
export function parseEventDate(text: string): number | null {
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(text.trim());
  if (dmy) {
    const month = MONTHS.indexOf(dmy[2].slice(0, 3).toLowerCase());
    return month < 0 ? null : dayNumber(+dmy[3], month, +dmy[1]);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim());
  return iso ? dayNumber(+iso[1], +iso[2] - 1, +iso[3]) : null;
}

/** "09:30" -> 570, or null. */
export function parseTime(text: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((text ?? "").trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

/** "2026-03-13T08:00[:00]" -> minutes since epoch, or null. */
export function parseDateTime(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  if (!m) return null;
  return dayNumber(+m[1], +m[2] - 1, +m[3]) * DAY_MINUTES + (m[4] ? +m[4] * 60 + +m[5] : 0);
}

/** 570 -> "09:30" (time of day only). */
export function formatClock(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes since epoch -> "13 Mar 2026, 08:00". */
export function formatDateTime(minutes: number): string {
  const d = new Date(minutes * 60000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getUTCFullYear()}`;
  return `${date}, ${formatClock(minutes)}`;
}

/** "08:00 - 22:00" -> { open: 480, close: 1320 }, or null. */
export function parseOperatingHours(text: string | null | undefined): { open: number; close: number } | null {
  const [open, close] = (text ?? "").split("-").map((part) => parseTime(part));
  return open != null && close != null && close > open ? { open, close } : null;
}

export function weekdayName(day: number): string {
  // 1970-01-01 was a Thursday (index 3 in WEEKDAYS).
  return WEEKDAYS[(((day + 3) % 7) + 7) % 7];
}

// ---------------------------------------------------------------- windows

/** When the event itself runs, or null when its date/time isn't set yet. An end at/before the start runs past midnight. */
export function eventWindow(event: Pick<EventRecord, "date" | "start" | "end">): Window | null {
  const day = parseEventDate(event.date);
  const start = parseTime(event.start);
  let end = parseTime(event.end);
  if (day == null || start == null || end == null) return null;
  if (end <= start) end += DAY_MINUTES;
  const base = day * DAY_MINUTES;
  return { start: base + start, end: base + end };
}

/** How long the event keeps the venue busy: setup before, turnaround after (Week 7 change #1). */
export function occupiedWindow(
  event: Pick<EventRecord, "date" | "start" | "end">,
  venue: Pick<Venue, "setupMinutes" | "turnaroundMinutes">,
): Window | null {
  const w = eventWindow(event);
  if (!w) return null;
  return { start: w.start - (venue.setupMinutes || 0), end: w.end + (venue.turnaroundMinutes || 0) };
}

/** Touching windows (one ends exactly when the next starts) don't overlap. */
export function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

function describeWindow(w: Window, venue: Venue): string {
  const extras = [
    venue.setupMinutes ? `${venue.setupMinutes} min setup` : "",
    venue.turnaroundMinutes ? `${venue.turnaroundMinutes} min turnaround` : "",
  ].filter(Boolean);
  return `${formatClock(w.start)}–${formatClock(w.end)}${extras.length ? ` incl. ${extras.join(" and ")}` : ""}`;
}

// ---------------------------------------------------------------- availability checks

const CLOSED_STATUSES = new Set(["cancelled", "rejected", "completed"]);

/** Events that currently hold (or have asked for) a venue. */
export function holdsBooking(e: EventRecord): boolean {
  return (e.bookingState === "approved" || e.bookingState === "pending") && !CLOSED_STATUSES.has(e.status);
}

export function periodLabel(p: Venue["unavailability"][number]): string {
  return `${UNAVAILABILITY_REASONS[p.reason] ?? p.reason}${p.note ? `: ${p.note}` : ""}`;
}

/**
 * Why `venue` can't (or can only with caveats) be used for `event` at the event's time:
 * deactivation, closed days/hours, unavailability periods, and clashes with other bookings —
 * all using the occupied window, setup and turnaround included.
 *
 * `clashWith` decides which other bookings count: when choosing a venue, pending requests
 * count too; when checking an existing booking, only confirmed ones do.
 */
export function availabilityIssues(
  events: EventRecord[],
  venue: Venue,
  event: EventRecord,
  clashWith: "approved" | "approved_or_pending" = "approved_or_pending",
): Issue[] {
  const issues: Issue[] = [];
  if (!venue.isActive) {
    issues.push({ level: "block", text: `${venue.name} has been deactivated.` });
  }

  const ownWindow = eventWindow(event);
  const occupied = occupiedWindow(event, venue);
  if (!ownWindow || !occupied) return issues; // no date/time yet: nothing more to check

  const day = Math.floor(ownWindow.start / DAY_MINUTES);
  if (venue.operatingDays.length && !venue.operatingDays.includes(weekdayName(day))) {
    issues.push({ level: "block", text: `${venue.name} is closed on ${weekdayName(day)}s.` });
  }
  const hours = parseOperatingHours(venue.operatingHours);
  if (hours) {
    const base = day * DAY_MINUTES;
    if (ownWindow.start < base + hours.open || ownWindow.end > base + hours.close) {
      issues.push({ level: "block", text: `${event.start}–${event.end} is outside ${venue.name}'s operating hours (${venue.operatingHours}).` });
    } else if (occupied.start < base + hours.open || occupied.end > base + hours.close) {
      issues.push({ level: "warn", text: `Setup or turnaround (${describeWindow(occupied, venue)}) runs outside operating hours (${venue.operatingHours}).` });
    }
  }

  for (const period of venue.unavailability) {
    const start = parseDateTime(period.start);
    const end = parseDateTime(period.end);
    if (start == null || end == null) continue;
    if (overlaps(occupied, { start, end })) {
      issues.push({
        level: "block",
        text: `${venue.name} is unavailable (${periodLabel(period)}) from ${formatDateTime(start)} to ${formatDateTime(end)}.`,
      });
    }
  }

  for (const other of events) {
    if (other.id === event.id || other.venue !== venue.id || !holdsBooking(other)) continue;
    if (clashWith === "approved" && other.bookingState !== "approved") continue;
    const otherOccupied = occupiedWindow(other, venue);
    if (otherOccupied && overlaps(occupied, otherOccupied)) {
      const what = other.bookingState === "approved" ? "booked" : "requested";
      issues.push({
        level: "block",
        text: `Clashes with ${other.name}, already ${what} on ${other.date} (venue occupied ${describeWindow(otherOccupied, venue)}).`,
      });
    }
  }
  return issues;
}

/**
 * Every current booking that has a problem, keyed by event id: the venue was deactivated or
 * made unavailable, or its setup/turnaround now makes it clash with a confirmed booking.
 * These are flagged for the coordinator — never removed (Week 7 changes #1 and #2).
 */
export function bookingProblems(events: EventRecord[], venues: Venue[]): Record<string, Issue[]> {
  const out: Record<string, Issue[]> = {};
  for (const event of events) {
    if (!holdsBooking(event)) continue;
    const venue = venues.find((v) => v.id === event.venue);
    if (!venue) continue;
    const blockers = availabilityIssues(events, venue, event, "approved").filter((i) => i.level === "block");
    if (blockers.length) out[event.id] = blockers;
  }
  return out;
}

/** Bookings that a venue edit has newly put in trouble, with the new problems. */
export function newlyAffectedBookings(
  events: EventRecord[],
  venuesBefore: Venue[],
  venuesAfter: Venue[],
): Array<{ event: EventRecord; issues: Issue[] }> {
  const before = bookingProblems(events, venuesBefore);
  const after = bookingProblems(events, venuesAfter);
  return Object.entries(after)
    .map(([id, issues]) => {
      const known = new Set((before[id] ?? []).map((i) => i.text));
      return { event: events.find((e) => e.id === id)!, issues: issues.filter((i) => !known.has(i.text)) };
    })
    .filter((x) => x.issues.length > 0);
}

// ---------------------------------------------------------------- venue helpers

/** Case-insensitive "does this venue list `item`". */
export function venueHas(list: string[], item: string): boolean {
  return list.some((x) => x.toLowerCase() === item.toLowerCase());
}

export function hasStepFreeAccess(venue: Venue): boolean {
  return venueHas(venue.accessibility, "Step-free access") || venueHas(venue.accessibility, "Wheelchair access");
}

export function venueFromApi(v: ApiVenue): Venue {
  return {
    id: String(v.id),
    name: v.name,
    building: v.building,
    cap: v.cap,
    layouts: v.layouts ?? [],
    facilities: v.facilities ?? [],
    accessibility: v.accessibility ?? [],
    operatingHours: v.operatingHours ?? null,
    operatingDays: v.operatingDays ?? [],
    unavailability: v.unavailability ?? [],
    setupMinutes: v.setupMinutes ?? 0,
    turnaroundMinutes: v.turnaroundMinutes ?? 0,
    isActive: v.is_active,
    lastUpdatedBy: v.last_updated_by,
    lastUpdatedAt: v.last_updated_at,
  };
}
