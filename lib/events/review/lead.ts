import type { EventRecord } from "../../types";
import type { Coordinator } from "./api";

/**
 * US43 / US11: what the Event Coordinator Lead's Assignments page shows, and what a coordinator is told
 * when the Lead assigns them. The server decides which events each role receives (backend/event_access.py);
 * these only arrange what it sent.
 */

/** The requests nobody coordinates yet, in the order the server sent them (oldest submission first). */
export function unassignedRequests(events: EventRecord[]): EventRecord[] {
  return events.filter((e) => !e.coordinator);
}

/** Each coordinator, in the given order, with the events assigned to them. */
export function coordinatorWorkloads(events: EventRecord[], coordinators: Coordinator[]): Array<{ name: string; events: EventRecord[] }> {
  return coordinators.map((c) => ({ name: c.name, events: events.filter((e) => e.coordinator === c.name) }));
}

/** The top bar subtitle of the Assignments page. */
export function waitingSubtitle(events: EventRecord[]): string {
  const n = unassignedRequests(events).length;
  return `${n} request${n === 1 ? "" : "s"} waiting for a coordinator`;
}

/** US11 AC3: who assigned the coordinator and when, as shown on the Request tab (null before any recorded assignment). */
export function assignmentNote(event: Pick<EventRecord, "assignedBy" | "assignedAt">, formatTime: (iso: string) => string): string | null {
  if (!event.assignedBy) return null;
  return `Assigned by ${event.assignedBy}${event.assignedAt ? ` on ${formatTime(event.assignedAt)}` : ""}`;
}

/** US11 AC4: a notice for each request assigned to the coordinator that they haven't started on. */
export function assignmentNotices(events: Array<{ name: string; status: string; assignedBy?: string | null }>): Array<{ title: string; body: string }> {
  return events
    .filter((e) => e.status === "submitted")
    .map((e) => ({ title: "Event assigned to you", body: `${e.assignedBy ?? "The Event Coordinator Lead"} assigned ${e.name} to you.` }));
}
