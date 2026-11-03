import type { EventStatus } from "../types";

/**
 * US14 — Confirm Event, on the page. The server decides whether an event can be confirmed and lists what is
 * outstanding (backend/event_confirmation.py, GET /events/{id}/confirmation); these helpers only show it.
 */

/** GET /events/{id}/confirmation. */
export interface ConfirmationStatus {
  ready: boolean;
  confirmed: boolean;
  /** AC2: every arrangement still in the way, one per line, in the order to work through them. */
  outstanding: string[];
  /** AC3: when the event was confirmed, and by whom. */
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** AC5: the fields that can no longer be edited once the event is confirmed. */
  lockedFields: string[];
}

/** Statuses in which the confirmation checklist is worth showing: approved, through the safety check, and confirmed. */
export const CONFIRMATION_STATUSES: readonly EventStatus[] = [
  "approved", "pending_safety_review", "safety_changes_requested", "safety_rejected", "safety_approved", "confirmed",
];

export function showsConfirmation(status: EventStatus): boolean {
  return CONFIRMATION_STATUSES.includes(status);
}

/** Field names as people read them (the US16 detail fields, plus the equipment request). */
const FIELD_LABELS: Record<string, string> = {
  name: "name", purpose: "description", eventType: "event type", pax: "expected attendance", date: "date",
  start: "start time", end: "end time", venueLocation: "venue location", venueCapacity: "venue capacity",
  layout: "layout", facilities: "facilities", access: "accessibility", equip: "equipment", reg: "registration",
  regCap: "registration capacity", regClose: "registration closing date", equipment: "equipment request",
};

/** AC5: "date, start time, … and equipment request", each field once, in the order given. */
export function lockedFieldsSummary(fields: readonly string[]): string {
  const names = [...new Set(fields.map((f) => FIELD_LABELS[f] ?? f))];
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** AC3: "Confirmed by Priya Tan on 04 Jan 2027, 09:30", with the time formatted by the caller. */
export function confirmedNote(status: Pick<ConfirmationStatus, "confirmedAt" | "confirmedBy">, formatTime: (iso: string) => string): string {
  const by = status.confirmedBy ? ` by ${status.confirmedBy}` : "";
  const when = status.confirmedAt ? ` on ${formatTime(status.confirmedAt)}` : "";
  return `Confirmed${by}${when}`;
}
