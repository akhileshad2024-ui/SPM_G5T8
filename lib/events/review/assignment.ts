import type { Actor, EventRecord, EventStatus, WorkflowResult } from "../../types";
import { fail, isCoordinator, withChanges } from "./shared";

/**
 * Coordinators can only be assigned while an event is still live: once it has
 * been submitted and until it is closed. Drafts still belong to the organiser,
 * and rejected / cancelled / completed events need no coordinator.
 */
export const ASSIGNABLE_STATUSES: readonly EventStatus[] = [
  "submitted",
  "under_review",
  "pending_clarification",
  "approved",
  "planning",
  "confirmed",
];

export function canAssignCoordinator(event: EventRecord): boolean {
  return ASSIGNABLE_STATUSES.includes(event.status);
}

/**
 * US11: gives an unassigned event its main internal point of contact.
 * `coordinators` is the list of staff who hold the Event Coordinator role.
 * Changing an existing coordinator is reassignment (US12), not handled here.
 */
export function assignCoordinator(
  event: EventRecord,
  actor: Actor,
  { coordinator, coordinators }: { coordinator: string; coordinators: readonly string[] },
): WorkflowResult {
  if (!isCoordinator(actor)) {
    return fail("Only Event Coordinators can assign coordinators.");
  }
  if (!coordinators.includes(coordinator)) {
    return fail(`${coordinator || "That person"} is not an Event Coordinator.`);
  }
  if (!canAssignCoordinator(event)) {
    return fail(`A coordinator can't be assigned while the event is ${event.status.replace("_", " ")}.`);
  }
  if (event.coordinator) {
    return fail(`${event.coordinator} is already coordinating this event.`);
  }

  return {
    ok: true,
    event: withChanges(
      event,
      { coordinator },
      {
        title: "Coordinator assigned",
        body: `${actor.name} assigned ${coordinator} as the main internal point of contact.`,
      },
    ),
    notifications: [
      { to: "organiser", title: "Coordinator assigned", body: `${coordinator} is coordinating ${event.name}.` },
      { to: "coordinator", title: "Event assigned to you", body: `${actor.name} assigned ${event.name} to ${coordinator}.` },
    ],
  };
}
