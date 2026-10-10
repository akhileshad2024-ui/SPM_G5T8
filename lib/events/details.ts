/**
 * US15: an event's details as the signed-in role may see them, worded for the details view.
 *
 * The backend leaves out fields the role may not see (backend/event_fields.py), so a field
 * that is absent here produces no row at all: hidden, not shown as empty. A field that is
 * present but has no value is the role's to see, so it is shown as "Not set" / "None".
 */
import type { StoredEvent } from "./request/api";
import { formatChangedAt, statusLabel } from "./status-history";
import type { EventStatus } from "../types";

export interface DetailRow {
  label: string;
  value: string;
}

export interface DetailSection {
  title: string;
  rows: DetailRow[];
}

const NOT_SET = "Not set";

function has<K extends keyof StoredEvent>(e: StoredEvent, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(e, key);
}

function list(items: string[] | undefined | null): string {
  return items && items.length ? items.join(", ") : "None";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "26 Nov 2026" from "2026-11-26". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return NOT_SET;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "09:00 – 17:00" from "09:00:00" / "17:00:00". */
export function formatTimes(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return NOT_SET;
  return `${start?.slice(0, 5) ?? "?"} – ${end?.slice(0, 5) ?? "?"}`;
}

/**
 * "95 expected" / "95 pax", or "attendance not set" while the organiser hasn't given one.
 * Lists store a missing attendance as 0 (the server only saves positive numbers).
 */
export function attendanceLabel(pax: number | null | undefined, unit: string): string {
  return pax != null && pax > 0 ? `${pax} ${unit}` : "attendance not set";
}

/** "Last updated 08 Oct 2026, 17:23" in the viewer's time zone (or `timeZone`). */
export function lastUpdatedLabel(e: Pick<StoredEvent, "updatedAt">, timeZone?: string): string {
  return `Last updated ${formatChangedAt(e.updatedAt, timeZone)}`;
}

/**
 * The details the role may see, grouped for display. Sections whose fields were all left
 * out by the backend are omitted. `equipName` turns a catalogue id ("E2") into its name.
 */
export function detailSections(
  e: StoredEvent,
  equipName: (id: string) => string = (id) => id,
  timeZone?: string,
): DetailSection[] {
  const sections: DetailSection[] = [];
  const add = (title: string, rows: Array<DetailRow | null>) => {
    const shown = rows.filter((r): r is DetailRow => r !== null);
    if (shown.length) sections.push({ title, rows: shown });
  };
  const row = (present: boolean, label: string, value: () => string): DetailRow | null =>
    present ? { label, value: value() } : null;

  add("Event", [
    { label: "Status", value: statusLabel(e.status as EventStatus) },
    row(has(e, "eventType"), "Event type", () => (e.eventType ? capitalise(e.eventType) : NOT_SET)),
    row(has(e, "purpose"), "Description", () => e.purpose || NOT_SET),
    row(has(e, "date"), "Date", () => formatDate(e.date)),
    row(has(e, "start") || has(e, "end"), "Time", () => formatTimes(e.start, e.end)),
    row(has(e, "pax"), "Expected attendance", () => (e.pax == null ? NOT_SET : String(e.pax))),
  ]);

  add("People", [
    { label: "Organiser", value: e.organiser },
    row(has(e, "coordinator"), "Coordinator", () => e.coordinator ?? "Not yet assigned"),
  ]);

  add("Venue", [
    row(has(e, "venueName"), "Venue", () => e.venueName ?? "Not booked yet"),
    row(has(e, "bookingState"), "Booking", () => (e.bookingState ? capitalise(e.bookingState) : "Not requested")),
    row(has(e, "venueLocation"), "Preferred location", () => e.venueLocation || NOT_SET),
    row(has(e, "venueCapacity"), "Required capacity", () => (e.venueCapacity == null ? NOT_SET : String(e.venueCapacity))),
    row(has(e, "layout"), "Layout", () => (e.layout ? capitalise(e.layout) : NOT_SET)),
    row(has(e, "facilities"), "Facilities", () => list(e.facilities)),
    row(has(e, "access"), "Accessibility", () => list(e.access)),
  ]);

  add("Equipment", [
    row(has(e, "equip"), "Requested", () =>
      e.equip && e.equip.length
        ? e.equip
            .map((it) => `${it.qty} × ${equipName(it.id)}${it.technicalRequirements ? ` (${it.technicalRequirements})` : ""}`)
            .join("; ")
        : "None",
    ),
    row(has(e, "equipState"), "Equipment status", () => (e.equipState ? capitalise(e.equipState) : "None requested")),
  ]);

  add("Registration", [
    row(has(e, "reg"), "Attendee registration", () => (e.reg ? "Open" : "Not required")),
    row(has(e, "regCap") && !!e.reg, "Capacity limit", () => (e.regCap == null ? NOT_SET : String(e.regCap))),
    row(has(e, "regClose") && !!e.reg, "Closes", () => formatDate(e.regClose)),
  ]);

  add("Review", [
    row(has(e, "submittedAt"), "Submitted", () => (e.submittedAt ? formatChangedAt(e.submittedAt, timeZone) : "Not submitted yet")),
    row(has(e, "clarification") && !!e.clarification, "Clarification requested", () => String(e.clarification?.message ?? "")),
    row(has(e, "decision") && !!e.decision, "Decision", () => {
      const d = e.decision!;
      const outcome = capitalise(String(d.outcome ?? ""));
      return d.reason ? `${outcome}: ${d.reason}` : outcome;
    }),
  ]);

  return sections;
}
