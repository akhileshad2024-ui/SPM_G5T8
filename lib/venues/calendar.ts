import type { UnavailabilityReason } from "../types";
import { formatCampusTime } from "./hold-expiry";
import { formatClock, formatDateTime, overlaps, parseDateTime, parseEventDate, periodLabel, type Window } from "./rules";

/**
 * US19 — the venue availability calendar (Week 7 changes CR-W7-1, CR-W7-4), on the page.
 *
 * The server works out what each venue's time looks like (backend/venue_calendar.py), including which
 * events a viewer may see named; these helpers only choose the days to ask for and word what comes back.
 * Dates are "YYYY-MM-DD" strings in campus time, counted through whole days so no time zones are involved.
 */

export type CalendarView = "day" | "week" | "month";

/** One stretch of a venue's time. For a booking, `start` and `end` are the occupied window, setup and turnaround included. */
export interface CalendarPeriod {
  kind: "confirmed" | "pending" | "expired" | "unavailable";
  start: string;
  end: string;
  event_start: string | null;
  event_end: string | null;
  setup_minutes: number | null;
  turnaround_minutes: number | null;
  hold_expires_at: string | null;
  /** Null when the viewer may not see this event (US19-AC5). */
  event_id: number | null;
  event_name: string | null;
  reason: UnavailabilityReason | null;
  note: string | null;
}

export interface CalendarVenue {
  id: number;
  name: string;
  setup_minutes: number;
  turnaround_minutes: number;
  periods: CalendarPeriod[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;
const CAMPUS_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEK_LENGTH = 7;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const WEEKDAY_HEADERS = WEEKDAYS;

function dayNumber(iso: string): number {
  return parseEventDate(iso)!;
}

function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 for a Monday ... 6 for a Sunday. 1970-01-01 was a Thursday. */
function weekdayIndex(day: number): number {
  return (((day + 3) % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH;
}

/** "04 Jan 2027" for 2027-01-04. */
function shortDate(iso: string): string {
  return formatDateTime(dayNumber(iso) * DAY_MINUTES).split(",")[0];
}

function daysBetween(first: number, last: number): string[] {
  return Array.from({ length: last - first + 1 }, (_, i) => isoDate(first + i));
}

/** Today's date on campus. */
export function campusToday(now: number = Date.now()): string {
  return new Date(now + CAMPUS_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The days a view shows around `anchor`: the one day, Monday to Sunday of its week, or whole
 * weeks covering its month, so a month view always starts on a Monday and ends on a Sunday.
 */
export function visibleDays(view: CalendarView, anchor: string): string[] {
  const day = dayNumber(anchor);
  if (view === "day") return [anchor];
  if (view === "week") {
    const monday = day - weekdayIndex(day);
    return daysBetween(monday, monday + WEEK_LENGTH - 1);
  }
  const [year, month] = anchor.split("-").map(Number);
  const first = Date.UTC(year, month - 1, 1) / DAY_MS;
  const last = Date.UTC(year, month, 0) / DAY_MS;
  return daysBetween(first - weekdayIndex(first), last + (WEEK_LENGTH - 1 - weekdayIndex(last)));
}

/** The anchor one step (`direction` = 1) or one step back (-1) from this one. A month step lands on the 1st. */
export function moveAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return isoDate(dayNumber(anchor) + direction);
  if (view === "week") return isoDate(dayNumber(anchor) + direction * WEEK_LENGTH);
  const [year, month] = anchor.split("-").map(Number);
  return isoDate(Date.UTC(year, month - 1 + direction, 1) / DAY_MS);
}

/** What the toolbar calls the days shown: "04 Jan 2027", "04 Jan 2027 – 10 Jan 2027" or "January 2027". */
export function rangeLabel(view: CalendarView, anchor: string): string {
  if (view === "day") return shortDate(anchor);
  if (view === "week") {
    const days = visibleDays("week", anchor);
    return `${shortDate(days[0])} – ${shortDate(days[WEEK_LENGTH - 1])}`;
  }
  const [year, month] = anchor.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** A column heading: "Mon 4". */
export function dayHeading(iso: string): string {
  const day = dayNumber(iso);
  return `${WEEKDAYS[weekdayIndex(day)]} ${Number(iso.slice(8))}`;
}

function windowOf(period: Pick<CalendarPeriod, "start" | "end">): Window {
  return { start: parseDateTime(period.start)!, end: parseDateTime(period.end)! };
}

/** The periods that reach into this day: a long unavailable period shows on each of its days. */
export function periodsOn(periods: CalendarPeriod[], iso: string): CalendarPeriod[] {
  const start = dayNumber(iso) * DAY_MINUTES;
  return periods.filter((period) => overlaps(windowOf(period), { start, end: start + DAY_MINUTES }));
}

/**
 * The bookings that need the venue at the same time as something else, setup and turnaround included. An
 * expired hold has released the venue, so it clashes with nothing. Venue Staff resolve clashes (US46-US48).
 */
export function clashingPeriods(periods: CalendarPeriod[]): Set<CalendarPeriod> {
  const live = periods.filter((period) => period.kind !== "expired");
  return new Set(
    live.filter((period) => period.kind !== "unavailable" && live.some((other) => other !== period && overlaps(windowOf(period), windowOf(other)))),
  );
}

/** What the period is: the event when the viewer may see it, otherwise only what kind of time it is. */
export function periodName(period: CalendarPeriod): string {
  if (period.kind === "unavailable") return periodLabel({ start: period.start, end: period.end, reason: period.reason!, note: period.note });
  if (period.event_name) return period.event_name;
  return { confirmed: "Booked", pending: "Tentative hold", expired: "Released hold" }[period.kind];
}

/** The time it covers. A booking's is how long it occupies the venue; an unavailable period may span several days. */
export function periodTimes(period: CalendarPeriod): string {
  const { start, end } = windowOf(period);
  const sameDay = Math.floor(start / DAY_MINUTES) === Math.floor(end / DAY_MINUTES);
  if (period.kind === "unavailable" && !sameDay) return `${formatDateTime(start)} – ${formatDateTime(end)}`;
  return `${formatClock(start)}–${formatClock(end)}`;
}

/** The small print: how the occupied window is made up (US19-AC3) and what happens to a hold (US19-AC6). */
export function periodNotes(period: CalendarPeriod): string[] {
  if (period.kind === "unavailable") return ["Unavailable"];
  const notes = [`Event ${period.event_start}–${period.event_end}, ${period.setup_minutes} min setup, ${period.turnaround_minutes} min turnaround`];
  if (period.kind === "pending" && period.hold_expires_at) notes.push(`Held until ${formatCampusTime(period.hold_expires_at)}`);
  if (period.kind === "expired") {
    notes.unshift(period.hold_expires_at ? `Released: hold expired ${formatCampusTime(period.hold_expires_at)}` : "Released: hold expired");
  }
  return notes;
}
