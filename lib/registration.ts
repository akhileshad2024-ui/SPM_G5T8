import { eventKey } from "./events/request/api";
import type { EventRecord, RegistrationRecord, RegistrationStatus } from "./types";

/**
 * US29-US31 registration rules, checked in the browser for an instant answer. The server
 * (backend/registrations.py) applies the same rules and has the final say: it also counts
 * places and runs the waitlist.
 */

export type RegistrationDecision =
  | { ok: true; status: Extract<RegistrationStatus, "registered" | "waitlisted"> }
  | { ok: false; reason: string };

/** The last moment a date allows: the end of that day for a date ("2026-11-19"), else the time given. */
function lastMoment(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999`).getTime() : new Date(value).getTime();
}

export function decideRegistration(event: EventRecord, existing?: RegistrationRecord, now = Date.now()): RegistrationDecision {
  if (existing && existing.status !== "withdrawn") return { ok: false, reason: `You already have a ${existing.status} registration for ${event.name}.` };
  if (!event.reg || event.status !== "confirmed") return { ok: false, reason: "Registration is not open for this event." };
  if (event.regClose && lastMoment(event.regClose) < now) return { ok: false, reason: `Registration for ${event.name} has closed.` };
  return { ok: true, status: event.regCap > 0 && event.registered >= event.regCap ? "waitlisted" : "registered" };
}

export function withdrawalError(event: EventRecord, registration?: RegistrationRecord, now = Date.now()): string | null {
  if (!registration || !["registered", "waitlisted"].includes(registration.status)) return "No active registration was found.";
  if (event.withdrawalClose && lastMoment(event.withdrawalClose) < now) return `The withdrawal deadline for ${event.name} has passed.`;
  return null;
}

/** A registration as the backend returns it (backend/schemas.py RegistrationResponse). */
export interface StoredRegistration {
  id: number;
  eventId: number;
  eventName: string;
  eventDate: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  attendeeName: string;
  attendeeEmail: string;
  status: RegistrationStatus;
  registeredAt: string;
  updatedAt: string;
}

/** Turns a stored registration into the shape the pages use. */
export function registrationFromApi(r: StoredRegistration): RegistrationRecord {
  return {
    id: `REG-${r.id}`,
    eventId: eventKey(r.eventId),
    eventName: r.eventName,
    eventDate: r.eventDate
      ? new Date(`${r.eventDate}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : undefined,
    eventStart: r.eventStart?.slice(0, 5),
    eventEnd: r.eventEnd?.slice(0, 5),
    attendeeName: r.attendeeName,
    attendeeEmail: r.attendeeEmail,
    status: r.status,
    registeredAt: r.registeredAt,
    updatedAt: r.updatedAt,
  };
}
