import type { Actor, EventRecord, WorkflowResult } from "../../types";

/** Upper bound for any free-text note so one message can't flood the activity log. */
export const MAX_NOTE_LENGTH = 1000;

/** Builds a failed workflow result. */
export function fail(error: string): WorkflowResult {
  return { ok: false, error };
}

/** Only Event Coordinators may review, decide on, or assign event requests. */
export function isCoordinator(actor: Actor): boolean {
  return actor.role === "coordinator";
}

/**
 * Shared guard for the review decisions (clarify, approve, reject): the event
 * must be under review, and only its assigned coordinator may act on it, since
 * they are the organiser's main point of contact. Returns an error or null.
 */
export function reviewDecisionError(event: EventRecord, actor: Actor): string | null {
  if (!isCoordinator(actor)) {
    return "Only Event Coordinators can review event requests.";
  }
  if (event.status === "submitted") {
    return "Start the review before making a decision on this request.";
  }
  if (event.status === "pending_clarification") {
    return "Waiting for the organiser to respond to your clarification request.";
  }
  if (event.status !== "under_review") {
    return "A decision has already been made on this request.";
  }
  if (!event.coordinator) {
    return "Assign a coordinator before making a decision on this request.";
  }
  if (event.coordinator !== actor.name) {
    return `Only the assigned coordinator (${event.coordinator}) can make this decision.`;
  }
  return null;
}

/**
 * Checks a free-text note. Returns an error message, or null when the note is
 * acceptable. `label` names the field in the message shown to the user.
 */
export function noteError(
  text: string,
  label: string,
  { required = true, minLength = 1 }: { required?: boolean; minLength?: number } = {},
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return required ? `${label} is required.` : null;
  if (trimmed.length < minLength) {
    return `${label} must be at least ${minLength} characters.`;
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return `${label} must be ${MAX_NOTE_LENGTH} characters or fewer.`;
  }
  return null;
}

/**
 * Returns a copy of `event` with `changes` applied and a new entry at the top
 * of its activity log. The original event is never mutated.
 */
export function withChanges(
  event: EventRecord,
  changes: Partial<EventRecord>,
  activity: { title: string; body: string },
): EventRecord {
  return {
    ...event,
    ...changes,
    activity: [{ when: "just now", ...activity }, ...event.activity],
  };
}
