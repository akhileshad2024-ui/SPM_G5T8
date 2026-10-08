import type { EventRecord, RegistrationRecord, RegistrationStatus } from "./types";

export type RegistrationDecision =
  | { ok: true; status: Extract<RegistrationStatus, "registered" | "waitlisted"> }
  | { ok: false; reason: string };

export function decideRegistration(event: EventRecord, existing?: RegistrationRecord, now = Date.now()): RegistrationDecision {
  if (existing && existing.status !== "withdrawn") return { ok: false, reason: `You already have a ${existing.status} registration for ${event.name}.` };
  if (!event.reg || !["planning", "confirmed"].includes(event.status)) return { ok: false, reason: "Registration is not open for this event." };
  if (event.regClose && new Date(event.regClose).getTime() < now) return { ok: false, reason: `Registration for ${event.name} has closed.` };
  return { ok: true, status: event.registered >= event.regCap ? "waitlisted" : "registered" };
}

export function withdrawalError(event: EventRecord, registration?: RegistrationRecord, now = Date.now()): string | null {
  if (!registration || !["registered", "waitlisted"].includes(registration.status)) return "No active registration was found.";
  if (event.withdrawalClose && new Date(event.withdrawalClose).getTime() < now) return `The withdrawal deadline for ${event.name} has passed.`;
  return null;
}
