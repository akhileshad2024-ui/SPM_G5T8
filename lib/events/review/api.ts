import type { ClarificationKind, EventRecord } from "../../types";
import { eventFromApi, type StoredEvent } from "../request/api";

/**
 * Saving the review steps (US07, US08, US10, US11) through the backend.
 *
 * The functions in this folder check a step on the page first (instant messages); the
 * backend checks it again with the same rules and saves it (backend/event_review.py).
 */

/** An Event Coordinator account, from GET /coordinators (US11). */
export interface Coordinator {
  id: number;
  name: string;
}

export type ReviewStep =
  | { step: "assign"; coordinatorId: number }
  | { step: "review" }
  | { step: "clarification"; kind: ClarificationKind; message: string }
  | { step: "decision"; outcome: "approved" | "rejected"; reason: string };

/** The endpoint and body for one step on a stored event. */
export function reviewRequest(backendId: number, request: ReviewStep): { path: string; body: Record<string, unknown> } {
  const path = `/events/${backendId}/${request.step}`;
  switch (request.step) {
    case "assign":
      return { path, body: { coordinatorId: request.coordinatorId } };
    case "review":
      return { path, body: {} };
    case "clarification":
      return { path, body: { kind: request.kind, message: request.message } };
    case "decision":
      return { path, body: { outcome: request.outcome, reason: request.reason } };
  }
}

/**
 * The event after a saved step: what the server stored (status, coordinator, clarification,
 * decision, last updated), plus what only the page keeps (its activity log and "… just now" label)
 * from the step's local result.
 */
export function withSavedReview(local: EventRecord, saved: StoredEvent): EventRecord {
  const stored = eventFromApi(saved);
  return {
    ...local,
    status: stored.status,
    coordinator: stored.coordinator,
    clarification: stored.clarification,
    decision: stored.decision,
    updatedAt: stored.updatedAt,
  };
}

/** The id of the coordinator account with this name, if there is one. */
export function coordinatorId(coordinators: readonly Coordinator[], name: string): number | undefined {
  return coordinators.find((c) => c.name === name)?.id;
}
