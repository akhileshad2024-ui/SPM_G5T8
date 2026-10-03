import type { Actor, EventRecord, WorkflowResult } from "../types";
import { fail, noteError, reviewDecisionError, withChanges } from "./shared";

/** A rejection reason has to be specific enough for the organiser to act on. */
export const MIN_REJECTION_REASON_LENGTH = 10;

/**
 * US10: the assigned coordinator approves a request under review. An
 * optional note is passed on to the organiser. Approved requests can then
 * proceed to venue booking.
 */
export function approveRequest(
  event: EventRecord,
  actor: Actor,
  note: string,
  now: Date,
): WorkflowResult {
  const guard = reviewDecisionError(event, actor);
  if (guard) return fail(guard);

  const invalid = noteError(note, "Approval note", { required: false });
  if (invalid) return fail(invalid);

  const text = note.trim();
  const body = `${actor.name} approved the request. It can now proceed to venue booking.`;
  return {
    ok: true,
    event: withChanges(
      event,
      {
        status: "approved",
        submittedAgo: "approved just now",
        decision: {
          outcome: "approved",
          by: actor.name,
          at: now.toISOString(),
          ...(text ? { reason: text } : {}),
        },
      },
      { title: "Request approved", body: text ? `${body} Note: ${text}` : body },
    ),
    notifications: [
      {
        to: "organiser",
        title: "Request approved",
        body: text
          ? `${event.name} has been approved. ${text}`
          : `${event.name} has been approved and moved into planning.`,
      },
    ],
  };
}

/**
 * US10: the assigned coordinator rejects a request under review. A reason is
 * mandatory so the organiser understands the outcome and can decide what to do.
 */
export function rejectRequest(
  event: EventRecord,
  actor: Actor,
  reason: string,
  now: Date,
): WorkflowResult {
  const guard = reviewDecisionError(event, actor);
  if (guard) return fail(guard);

  const invalid = noteError(reason, "Rejection reason", {
    minLength: MIN_REJECTION_REASON_LENGTH,
  });
  if (invalid) return fail(invalid);

  const text = reason.trim();
  return {
    ok: true,
    event: withChanges(
      event,
      {
        status: "rejected",
        submittedAgo: "rejected just now",
        decision: { outcome: "rejected", by: actor.name, at: now.toISOString(), reason: text },
      },
      { title: "Request rejected", body: `${actor.name}: ${text}` },
    ),
    notifications: [
      {
        to: "organiser",
        title: "Request rejected",
        body: `${event.name}: ${text}`,
      },
    ],
  };
}
