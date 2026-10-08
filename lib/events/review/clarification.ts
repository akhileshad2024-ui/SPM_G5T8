import type {
  Actor,
  ClarificationKind,
  EventRecord,
  WorkflowResult,
} from "../../types";
import { fail, noteError, reviewDecisionError, withChanges } from "./shared";

const KIND_LABEL: Record<ClarificationKind, string> = {
  clarification: "Clarification",
  amendment: "Amendment",
};

/**
 * US08: the assigned coordinator asks the organiser to clarify or amend their
 * request. The event moves to Pending clarification, which pauses approval
 * until the organiser replies.
 *
 * `now` is supplied by the caller so tests can use a fixed timestamp.
 */
export function requestClarification(
  event: EventRecord,
  actor: Actor,
  { kind, message }: { kind: ClarificationKind; message: string },
  now: Date,
): WorkflowResult {
  const guard = reviewDecisionError(event, actor);
  if (guard) return fail(guard);

  const label = KIND_LABEL[kind];
  const invalid = noteError(message, `${label} message`);
  if (invalid) return fail(invalid);

  const text = message.trim();
  return {
    ok: true,
    event: withChanges(
      event,
      {
        status: "pending_clarification",
        submittedAgo: "awaiting organiser reply",
        clarification: {
          kind,
          message: text,
          requestedBy: actor.name,
          requestedAt: now.toISOString(),
        },
      },
      { title: `${label} requested`, body: `${actor.name}: ${text}` },
    ),
    notifications: [
      {
        to: "organiser",
        title: `${label} requested`,
        body: `${event.name}: ${text}`,
      },
    ],
  };
}
