import type { Actor, EventRecord, WorkflowResult } from "../../types";
import { canAssignCoordinator } from "./assignment";
import { fail, isLead, noteError, withChanges } from "./shared";

/**
 * US12 — Reassign Event Coordinator (Week 7 change CR-W7-5).
 *
 * The Event Coordinator Lead moves an assigned event to another coordinator, with a reason. This checks
 * the step on the page for an instant message; the server checks it again with the same rules and
 * messages, moves access with the assignment and notifies everyone affected (backend/event_review.py
 * reassign, messaging.coordinator_reassigned).
 */
export function reassignCoordinator(
  event: EventRecord,
  actor: Actor,
  { coordinator, coordinators, reason }: { coordinator: string; coordinators: readonly string[]; reason: string },
  now: Date,
): WorkflowResult {
  if (!isLead(actor)) {
    return fail("Only the Event Coordinator Lead can reassign coordinators.");
  }
  if (!coordinators.includes(coordinator)) {
    return fail(`${coordinator || "That person"} is not an Event Coordinator.`);
  }
  if (!canAssignCoordinator(event)) {
    return fail(`A coordinator can't be reassigned while the event is ${event.status.replace("_", " ")}.`);
  }
  if (!event.coordinator) {
    return fail("This event has no coordinator yet. Assign one instead.");
  }
  if (event.coordinator === coordinator) {
    return fail(`${coordinator} is already coordinating this event.`);
  }
  const invalid = noteError(reason, "Reassignment reason");
  if (invalid) return fail(invalid);

  const previous = event.coordinator;
  const why = reason.trim();
  return {
    ok: true,
    event: withChanges(
      event,
      { coordinator, assignedBy: actor.name, assignedAt: now.toISOString() },
      { title: "Coordinator reassigned", body: `${actor.name} reassigned the event from ${previous} to ${coordinator}: ${why}` },
    ),
    // The server saves the notices for the people affected (US36); none are made on this page.
    notifications: [],
  };
}

/** US12-AC5: one entry of an event's assignment history, from GET /events/{id}/assignments (oldest first). */
export interface AssignmentHistoryEntry {
  coordinator: string | null;
  previousCoordinator: string | null;
  assignedBy: string | null;
  assignedAt: string;
  reason: string | null;
}

/** How one history entry reads, e.g. "Grace Ong reassigned it from Priya Tan to Marcus Lee: Priya is on leave." */
export function historyLine(entry: AssignmentHistoryEntry): string {
  const by = entry.assignedBy ?? "Someone";
  const to = entry.coordinator ?? "a coordinator who no longer has an account";
  if (!entry.previousCoordinator) return `${by} assigned ${to}`;
  return `${by} reassigned it from ${entry.previousCoordinator} to ${to}${entry.reason ? `: ${entry.reason}` : ""}`;
}

/** The coordinators an event can be handed to: everyone on the roster except the one coordinating it now. */
export function reassignTargets(event: Pick<EventRecord, "coordinator">, coordinators: readonly string[]): string[] {
  return coordinators.filter((c) => c !== event.coordinator);
}
